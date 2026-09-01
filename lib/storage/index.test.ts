import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaHash = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: { mediaHash } }));

import {
  deleteObject,
  readStoredObject,
  resolveStoredMediaUrl,
  storeMediaBytes,
} from "./index";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("database media storage", () => {
  it("stores bytes in PostgreSQL and returns the logical key", async () => {
    mediaHash.upsert.mockResolvedValue({ storageKey: "projects/p1/shot.png" });

    await expect(
      storeMediaBytes(
        new Uint8Array([1, 2, 3]),
        "projects/p1/shot.png",
        "image/png",
      ),
    ).resolves.toBe("projects/p1/shot.png");
    expect(mediaHash.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          data: Buffer.from([1, 2, 3]),
          mimeType: "image/png",
        }),
      }),
    );
  });

  it("renders stored bytes as a data URL", async () => {
    mediaHash.findUnique.mockResolvedValue({
      data: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
    });

    await expect(resolveStoredMediaUrl("projects/p1/shot.png")).resolves.toBe(
      "data:image/png;base64,AQID",
    );
    await expect(readStoredObject("projects/p1/shot.png")).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
  });

  it("deletes the database blob by logical key", async () => {
    mediaHash.deleteMany.mockResolvedValue({ count: 1 });
    await deleteObject("projects/p1/shot.png");
    expect(mediaHash.deleteMany).toHaveBeenCalledWith({
      where: { storageKey: "projects/p1/shot.png" },
    });
  });
});
