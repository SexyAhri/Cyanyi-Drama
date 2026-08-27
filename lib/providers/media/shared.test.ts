import { beforeEach, describe, expect, it, vi } from "vitest";

const readStoredObject = vi.hoisted(() => vi.fn());
const verifyLocalObjectSignature = vi.hoisted(() => vi.fn());

vi.mock("@/lib/storage", () => ({ readStoredObject }));
vi.mock("@/lib/storage/local", () => ({ verifyLocalObjectSignature }));

import { localReferencesAsDataUrls } from "./shared";

beforeEach(() => {
  vi.clearAllMocks();
  verifyLocalObjectSignature.mockReturnValue(true);
  readStoredObject.mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe("local media references", () => {
  it("reads a correctly signed local object even after its URL expires", async () => {
    const [result] = await localReferencesAsDataUrls([
      {
        url: "http://localhost:3000/api/files/projects/project-1/shot.png?expires=1&signature=valid",
      },
    ]);

    expect(verifyLocalObjectSignature).toHaveBeenCalledWith(
      "projects/project-1/shot.png",
      1,
      "valid",
    );
    expect(readStoredObject).toHaveBeenCalledWith(
      "projects/project-1/shot.png",
    );
    expect(result).toBe("data:image/png;base64,AQID");
  });

  it("does not bypass the file route for an invalid signature", async () => {
    verifyLocalObjectSignature.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(
      localReferencesAsDataUrls([
        {
          url: "http://localhost:3000/api/files/projects/project-1/shot.png?expires=1&signature=invalid",
        },
      ]),
    ).rejects.toThrow("REFERENCE_IMAGE_FETCH_FAILED:403");
    expect(readStoredObject).not.toHaveBeenCalled();
  });
});
