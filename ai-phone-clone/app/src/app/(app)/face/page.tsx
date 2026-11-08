import type { Metadata } from "next";
import { FaceToFace } from "./FaceToFace";

export const metadata: Metadata = { title: "Face-à-face" };

export default function FacePage() {
  return <FaceToFace />;
}
