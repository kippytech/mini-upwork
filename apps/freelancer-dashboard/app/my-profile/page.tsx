import type { Metadata } from "next";
import { ProfileEditor } from "./profile-editor";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "My Profile | Mini-upwork.io",
  description:
    "Manage your freelancer profile, portfolio, skills, and professional information.",
};

export default function MyProfilePage() {
  return (
    <Suspense>
      <ProfileEditor />
    </Suspense>
  );
}
