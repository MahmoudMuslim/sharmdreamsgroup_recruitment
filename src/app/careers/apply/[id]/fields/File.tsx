"use client";

import { UploadBox } from "./UploadBox";
import type { RendererProps } from "./types";

export function File(props: RendererProps) {
  return <UploadBox {...props} />;
}
