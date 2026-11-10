import { Metadata } from "next";
import JobDetails from "./job-details";

export const metadata: Metadata = {
  title: "Job details | Mini-upwork.io",
  description: "Review the project scope, skills, and milestones.",
};

export default async function JobDetailsPage() {
  return <JobDetails />;
}
