import { describe, expect, it } from "vitest";
import { scriptedDb } from "../../../__tests__/helpers/scriptedDb";
import type { LibraryActor } from "../../../lib/access";
import {
  createLibraryFolder,
  getLibrary,
  parseLibrarySourceKey,
  resolveLibraryWriteTarget,
  sourceFolderId,
} from "../library.service";

const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const personalOnly: LibraryActor = {
  userId: "u1",
  sources: [
    { id: null, label: "Personal", access_role: "owner", org_role: null },
  ],
};

const unionMember: LibraryActor = {
  userId: "u1",
  sources: [
    { id: null, label: "Personal", access_role: "owner", org_role: null },
    {
      id: ORG_ID,
      label: "Attune Legal",
      access_role: "viewer",
      org_role: "member",
    },
  ],
};

const unionAdmin: LibraryActor = {
  userId: "u1",
  sources: [
    { id: null, label: "Personal", access_role: "owner", org_role: null },
    {
      id: ORG_ID,
      label: "Attune Legal",
      access_role: "owner",
      org_role: "admin",
    },
  ],
};

describe("library union shelves", () => {
  it("parses personal and org source keys without flattening them", () => {
    expect(parseLibrarySourceKey("personal")).toBeNull();
    expect(parseLibrarySourceKey(sourceFolderId(null))).toBeNull();
    expect(parseLibrarySourceKey(sourceFolderId(ORG_ID))).toBe(ORG_ID);
    expect(parseLibrarySourceKey("not-a-source")).toBeUndefined();
  });

  it("keeps a personal-only library flat at the root", async () => {
    const fake = scriptedDb([
      { table: "documents", data: [] },
      { table: "library_folders", data: [{ id: "mine", name: "Precedents" }] },
    ]);
    const result = await getLibrary(fake.db, personalOnly, "file", null, {
      limit: 40,
      offset: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        documents: [],
        documentsHasMore: false,
        sources: [{ key: "personal", label: "Personal" }],
      },
    });
    if (!result.ok) throw new Error("expected personal root");
    expect(result.data.folders).toEqual([
      expect.objectContaining({
        id: "mine",
        name: "Precedents",
        source_label: "Personal",
        virtual: false,
      }),
    ]);
    fake.done();
  });

  it("groups a multi-org library by source instead of replacing personal", async () => {
    const fake = scriptedDb([]);
    const result = await getLibrary(fake.db, unionMember, "file", null, {
      limit: 40,
      offset: 0,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        documents: [],
        documentsHasMore: false,
        folders: [
          expect.objectContaining({
            id: "source:personal",
            name: "Personal",
            virtual: true,
            access_role: "owner",
          }),
          expect.objectContaining({
            id: `source:${ORG_ID}`,
            name: "Attune Legal",
            virtual: true,
            access_role: "viewer",
          }),
        ],
        sources: [
          expect.objectContaining({ key: "personal", label: "Personal" }),
          expect.objectContaining({
            id: ORG_ID,
            label: "Attune Legal",
            access_role: "viewer",
          }),
        ],
      },
    });
    fake.done();
  });

  it("keeps personal writes personal even when the caller has an org", async () => {
    const fake = scriptedDb([]);
    await expect(
      resolveLibraryWriteTarget(fake.db, unionAdmin, "file", {}),
    ).resolves.toEqual({
      ok: true,
      data: { orgId: null, folderId: null },
    });
    fake.done();
  });

  it("lets members read an org shelf but not mutate it", async () => {
    const fake = scriptedDb([]);
    await expect(
      createLibraryFolder(fake.db, unionMember, "file", {
        name: "Precedents",
        org_id: ORG_ID,
      }),
    ).resolves.toEqual({
      ok: false,
      failure: "status",
      status: 403,
      detail: "You do not have permission to change this library.",
    });
    fake.done();
  });

  it("lets org admins write the matching org shelf", async () => {
    const fake = scriptedDb([
      {
        table: "library_folders",
        op: "insert",
        data: { id: "firm", name: "Precedents", org_id: ORG_ID },
      },
    ]);
    const result = await createLibraryFolder(fake.db, unionAdmin, "file", {
      name: "Precedents",
      org_id: ORG_ID,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        id: "firm",
        org_id: ORG_ID,
        source_label: "Attune Legal",
        access_role: "owner",
      },
    });
    expect(fake.calls[0].payload).toEqual({
      user_id: "u1",
      org_id: ORG_ID,
      library_kind: "file",
      name: "Precedents",
      parent_folder_id: null,
    });
    fake.done();
  });
});
