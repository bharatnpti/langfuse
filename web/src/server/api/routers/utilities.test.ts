import { TRPCError } from "@trpc/server";
import axios from "axios";
import { type DeepMockProxy, mockDeep } from "jest-mock-extended";
import { utilsRouter } from "@/src/server/api/routers/utilities"; // Adjust path as necessary
import { type TrpcContext } from "@/src/server/api/trpc"; // Adjust path as necessary

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Create a type for the caller, adapting to how procedures are invoked in tests
// This might need adjustment based on the project's actual TRPC test setup
type UtilsRouterCaller = ReturnType<typeof utilsRouter.createCaller>;

describe("utilsRouter.fetchGitHubContent", () => {
  let ctx: DeepMockProxy<TrpcContext>;
  let caller: UtilsRouterCaller;

  beforeEach(() => {
    ctx = mockDeep<TrpcContext>();
    // If your TRPC setup involves a context object `ctx` passed to procedures,
    // you might need to create a caller like this:
    // caller = utilsRouter.createCaller(ctx);
    // For procedures that don't rely heavily on ctx, direct invocation might also be possible
    // or a simplified caller creation might be used.
    // For now, assuming procedures can be called if the router is structured to allow it
    // or that createCaller is standard. Let's assume a simple caller for now.
    caller = utilsRouter.createCaller({} as any); // Simplified caller, adjust if ctx is needed
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Success Cases
  describe("Success Cases", () => {
    it("should fetch content from a valid raw.githubusercontent.com URL", async () => {
      const mockUrl = "https://raw.githubusercontent.com/user/repo/main/file.txt";
      const mockContent = "This is a test file.";
      mockedAxios.get.mockResolvedValueOnce({ status: 200, data: mockContent });

      const result = await caller.fetchGitHubContent({ url: mockUrl });

      expect(result).toBe(mockContent);
      expect(mockedAxios.get).toHaveBeenCalledWith(mockUrl, {
        headers: { Accept: "text/plain" },
        timeout: 5000,
      });
    });

    it("should fetch content from a valid github.com/user/repo/blob/... URL and transform it", async () => {
      const blobUrl = "https://github.com/user/repo/blob/main/file.txt";
      const rawUrl = "https://raw.githubusercontent.com/user/repo/main/file.txt";
      const mockContent = "This is a test file from blob URL.";
      mockedAxios.get.mockResolvedValueOnce({ status: 200, data: mockContent });

      const result = await caller.fetchGitHubContent({ url: blobUrl });

      expect(result).toBe(mockContent);
      expect(mockedAxios.get).toHaveBeenCalledWith(rawUrl, { // Expect transformed URL
        headers: { Accept: "text/plain" },
        timeout: 5000,
      });
    });
  });

  // Error Cases: Input Validation
  describe("Error Cases: Input Validation", () => {
    it("should throw BAD_REQUEST for a non-URL string", async () => {
      const invalidUrl = "not-a-url";
      await expect(
        caller.fetchGitHubContent({ url: invalidUrl })
      ).rejects.toThrowError(
        new TRPCError({ code: "BAD_REQUEST", message: "Invalid URL format." })
      );
    });

    it("should throw BAD_REQUEST for a URL from a non-GitHub domain", async () => {
      const nonGitHubUrl = "https://example.com/file.txt";
      await expect(
        caller.fetchGitHubContent({ url: nonGitHubUrl })
      ).rejects.toThrowError(
        new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid GitHub URL. Only raw.githubusercontent.com or github.com/.../blob/... URLs are allowed.",
        })
      );
    });

    it("should throw BAD_REQUEST for a GitHub URL that is not raw or blob", async () => {
      const nonRawOrBlobGitHubUrl = "https://github.com/user/repo/tree/main";
      await expect(
        caller.fetchGitHubContent({ url: nonRawOrBlobGitHubUrl })
      ).rejects.toThrowError(
        new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid GitHub URL. Only raw.githubusercontent.com or github.com/.../blob/... URLs are allowed.",
        })
      );
    });
  });

  // Error Cases: GitHub Responses
  describe("Error Cases: GitHub Responses", () => {
    const testUrl = "https://raw.githubusercontent.com/user/repo/main/file.txt";

    it("should throw NOT_FOUND if GitHub returns 404", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 404, statusText: "Not Found" },
      });
      await expect(
        caller.fetchGitHubContent({ url: testUrl })
      ).rejects.toThrowError(
        new TRPCError({ code: "NOT_FOUND", message: "GitHub request failed: 404 Not Found" })
      );
    });

    it("should throw FORBIDDEN if GitHub returns 403", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 403, statusText: "Forbidden" },
      });
      await expect(
        caller.fetchGitHubContent({ url: testUrl })
      ).rejects.toThrowError(
        new TRPCError({ code: "FORBIDDEN", message: "GitHub request failed: 403 Forbidden" })
      );
    });

    it("should throw INTERNAL_SERVER_ERROR for other non-2xx GitHub error statuses (e.g., 500)", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 500, statusText: "Internal Server Error" },
      });
      await expect(
        caller.fetchGitHubContent({ url: testUrl })
      ).rejects.toThrowError(
        new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "GitHub request failed: 500 Internal Server Error" })
      );
    });

    it("should throw PAYLOAD_TOO_LARGE if content exceeds 1MB", async () => {
      const largeContent = "a".repeat(1_000_001); // 1MB + 1 byte
      mockedAxios.get.mockResolvedValueOnce({ status: 200, data: largeContent });
      await expect(
        caller.fetchGitHubContent({ url: testUrl })
      ).rejects.toThrowError(
        new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Content exceeds maximum allowed size of 1000000 bytes." })
      );
    });

    it("should throw PRECONDITION_FAILED if content is not plain text", async () => {
      mockedAxios.get.mockResolvedValueOnce({ status: 200, data: { not: "a string" } });
      await expect(
        caller.fetchGitHubContent({ url: testUrl })
      ).rejects.toThrowError(
        new TRPCError({ code: "PRECONDITION_FAILED", message: "Content fetched is not plain text." })
      );
    });
  });

  // Error Cases: Network/Internal
  describe("Error Cases: Network/Internal", () => {
    const testUrl = "https://raw.githubusercontent.com/user/repo/main/file.txt";

    it("should throw INTERNAL_SERVER_ERROR for a generic network error (error.request set)", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        isAxiosError: true,
        request: {}, // Indicates a network error where response was not received
        message: "Network Error",
      });
      await expect(
        caller.fetchGitHubContent({ url: testUrl })
      ).rejects.toThrowError(
        new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Network error while trying to reach GitHub." })
      );
    });

    it("should throw INTERNAL_SERVER_ERROR for a non-Axios error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Some other error"));
      await expect(
        caller.fetchGitHubContent({ url: testUrl })
      ).rejects.toThrowError(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred while fetching content from GitHub.",
        })
      );
    });
  });
});

// Helper to create a TRPC caller if not available or different in the project
// This is a simplified example.
// const createTestCaller = (router: any, ctx: any) => {
//   return router.createCaller(ctx);
// };
// Example: caller = createTestCaller(utilsRouter, ctx);
// Or, if procedures can be called directly for testing (e.g. if they don't use ctx):
// result = await utilsRouter.fetchGitHubContent({ rawInput: { url: mockUrl }, ctx });
// The exact invocation method depends on the TRPC setup and testing conventions of the project.
// The current implementation uses `utilsRouter.createCaller({} as any)` which might need refinement
// if the context (ctx) is actually used by the procedure for logging or other purposes not mocked.
// However, fetchGitHubContent primarily uses axios and Zod, so a minimal ctx might suffice.
