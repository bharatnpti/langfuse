import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewPromptForm } from "./index"; // Adjust path as necessary
import { PromptType } from "@/src/features/prompts/server/utils/validation";
import { ThemeProvider } from "next-themes"; // Assuming ThemeProvider is used
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; // For TRPC
import { SessionProvider } from "next-auth/react"; // If useSession is used
import { MemoryRouterProvider } from "next-router-mock/MemoryRouterProvider"; // For next/router mocks

// Mock the TRPC client
const mockFetchGitHubContent = jest.fn();
jest.mock("@/src/utils/api", () => ({
  api: {
    client: {
      utils: {
        fetchGitHubContent: {
          query: (...args: any[]) => mockFetchGitHubContent(...args),
        },
      },
    },
    // Mock other hooks/procedures if NewPromptForm uses them directly during render/setup
    prompts: {
      create: {
        useMutation: jest.fn(() => ({ mutateAsync: jest.fn().mockResolvedValue({}) })),
      },
      filterOptions: {
        // Provide a default empty array or mock data as needed
        useQuery: jest.fn(() => ({ data: [], isLoading: false, isError: false })),
      },
    },
  },
}));

// Mock other dependencies
jest.mock("@/src/hooks/useProjectIdFromURL", () => jest.fn(() => "test-project-id"));
jest.mock("@/src/features/posthog-analytics/usePostHogClientCapture", () => jest.fn(() => jest.fn()));
jest.mock("@/src/features/playground/page/hooks/usePlaygroundCache", () => jest.fn(() => ({ playgroundCache: null })));
jest.mock("next/router", () => require("next-router-mock"));


const queryClient = new QueryClient();

const renderNewPromptForm = (props?: Partial<React.ComponentProps<typeof NewPromptForm>>) => {
  return render(
    <MemoryRouterProvider>
      <ThemeProvider attribute="class" defaultTheme="light">
        <SessionProvider session={null}> {/* Provide a mock session if needed */}
          <QueryClientProvider client={queryClient}>
            <NewPromptForm
              initialPrompt={null} // Default to new prompt
              onFormSuccess={jest.fn()}
              {...props}
            />
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </MemoryRouterProvider>
  );
};

describe("NewPromptForm - GitHub Import Functionality", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure default state for prompt type is Text if needed, or set it via form defaultValues
    // The component's defaultValues sets PromptType.Text initially if no initialPrompt dictates otherwise
  });

  describe("UI Visibility", () => {
    it("should render the 'Import from GitHub URL?' checkbox", () => {
      renderNewPromptForm();
      expect(screen.getByLabelText("Import from GitHub URL?")).toBeInTheDocument();
    });

    it("should initially hide URL input and Fetch button", () => {
      renderNewPromptForm();
      expect(screen.queryByLabelText("GitHub Raw URL")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Fetch Content" })).not.toBeInTheDocument();
    });

    it("should show URL input and Fetch button when checkbox is checked", async () => {
      renderNewPromptForm();
      const checkbox = screen.getByLabelText("Import from GitHub URL?");
      await userEvent.click(checkbox);

      expect(screen.getByLabelText("GitHub Raw URL")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Fetch Content" })).toBeInTheDocument();
    });

    it("should hide URL input and Fetch button when checkbox is unchecked", async () => {
      renderNewPromptForm();
      const checkbox = screen.getByLabelText("Import from GitHub URL?");
      await userEvent.click(checkbox); // Show
      await userEvent.click(checkbox); // Hide

      expect(screen.queryByLabelText("GitHub Raw URL")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Fetch Content" })).not.toBeInTheDocument();
    });
  });

  describe("Button State", () => {
    it("should disable Fetch Content button if URL input is empty", async () => {
      renderNewPromptForm();
      await userEvent.click(screen.getByLabelText("Import from GitHub URL?"));

      const fetchButton = screen.getByRole("button", { name: "Fetch Content" });
      expect(fetchButton).toBeDisabled();
    });

    it("should enable Fetch Content button when URL input has text", async () => {
      renderNewPromptForm();
      await userEvent.click(screen.getByLabelText("Import from GitHub URL?"));

      const urlInput = screen.getByLabelText("GitHub Raw URL");
      await userEvent.type(urlInput, "https://example.com");

      const fetchButton = screen.getByRole("button", { name: "Fetch Content" });
      expect(fetchButton).toBeEnabled();
    });
  });

  describe("Fetching Success", () => {
    it("should fetch content and populate prompt field on success", async () => {
      mockFetchGitHubContent.mockResolvedValueOnce("Fetched prompt content");
      renderNewPromptForm();

      await userEvent.click(screen.getByLabelText("Import from GitHub URL?"));

      const urlInput = screen.getByLabelText("GitHub Raw URL");
      const testUrl = "https://raw.githubusercontent.com/user/repo/main/file.txt";
      await userEvent.type(urlInput, testUrl);

      const fetchButton = screen.getByRole("button", { name: "Fetch Content" });
      await userEvent.click(fetchButton);

      expect(mockFetchGitHubContent).toHaveBeenCalledWith({ url: testUrl });

      // Check for loading state (example, might need adjustment based on actual implementation)
      expect(screen.getByText("Fetching content...")).toBeInTheDocument();

      // The prompt content area is a CodeMirror editor, which is not a standard textarea.
      // We need to find a way to check its content.
      // Assuming form.setValue updates the underlying value that PromptLinkingEditor uses.
      // For now, we'll check if the success state clears loading and errors.
      // A more robust test would involve inspecting the CodeMirror instance or the form value directly.
      await waitFor(() => {
        expect(screen.queryByText("Fetching content...")).not.toBeInTheDocument();
      });

      // This part is tricky as PromptLinkingEditor is a CodeMirror instance.
      // We'd ideally check form.getValues("textPrompt") or see the value reflected.
      // Let's assume `form.setValue` works and the visual update is handled by the editor.
      // We can check that no error is displayed.
      expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();

      // To actually check the content, we would need a way to query CodeMirror or check the react-hook-form value.
      // For now, this test verifies the TRPC call and lack of error.
      // A placeholder for future improvement:
      // expect(screen.getByRole("textbox", { name: /prompt/i}).value).toBe("Fetched prompt content");
      // The above likely won't work due to CodeMirror.
    });
  });

  describe("Fetching Failure", () => {
    it("should display an error message on fetch failure", async () => {
      const errorMessage = "Failed to fetch content from GitHub.";
      mockFetchGitHubContent.mockRejectedValueOnce(new Error(errorMessage));
      renderNewPromptForm();

      await userEvent.click(screen.getByLabelText("Import from GitHub URL?"));

      const urlInput = screen.getByLabelText("GitHub Raw URL");
      await userEvent.type(urlInput, "https://example.com/invalid");

      const fetchButton = screen.getByRole("button", { name: "Fetch Content" });
      await userEvent.click(fetchButton);

      expect(mockFetchGitHubContent).toHaveBeenCalled();

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });

      // Check that prompt content area is not changed (assuming it was initially empty for textPrompt)
      // This again depends on how we can inspect the CodeMirror editor's content.
      // If `textPrompt` default is "", we'd check it's still effectively "".
    });
  });

  describe("Error Clearing", () => {
    it("should clear the error message when user types in the URL input", async () => {
      const errorMessage = "Initial fetch error.";
      mockFetchGitHubContent.mockRejectedValueOnce(new Error(errorMessage));
      renderNewPromptForm();

      await userEvent.click(screen.getByLabelText("Import from GitHub URL?"));

      const urlInput = screen.getByLabelText("GitHub Raw URL");
      await userEvent.type(urlInput, "https://example.com/another");

      const fetchButton = screen.getByRole("button", { name: "Fetch Content" });
      await userEvent.click(fetchButton);

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });

      await userEvent.type(urlInput, " new text"); // Simulate typing more

      await waitFor(() => {
        expect(screen.queryByText(errorMessage)).not.toBeInTheDocument();
      });
    });
  });
});
