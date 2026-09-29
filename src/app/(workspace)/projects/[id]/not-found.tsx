import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <div className="stack">
      <h1>Project not found.</h1>
      <p className="quiet">
        No project with this id is visible to the signed-in founder.
      </p>
      <Link className="button" href="/projects">
        Back to projects
      </Link>
    </div>
  );
}
