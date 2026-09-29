import type { Metadata } from "next";
import { ActionForm } from "@/components/ui/action-form";
import { createProject } from "@/lib/projects/actions";

export const metadata: Metadata = {
  title: "New project",
};

export default function NewProjectPage() {
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>Start a project.</h1>
        </div>
      </div>
      <section className="panel">
        <div className="panel-body">
          <p className="quiet">
            The first project also creates a workspace named Workspace if you do not have one. No
            sample project is inserted for you.
          </p>
          <ActionForm action={createProject} submitLabel="Create project">
            <label className="field">
              <span>Name</span>
              <input name="name" required maxLength={160} />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea name="description" />
            </label>
            <label className="field">
              <span>Current milestone</span>
              <input name="milestone" required maxLength={200} />
            </label>
            <label className="field">
              <span>Repository URL, optional</span>
              <input name="repositoryUrl" type="url" />
            </label>
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
