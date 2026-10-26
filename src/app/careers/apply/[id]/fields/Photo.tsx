"use client";

import { UploadBox } from "./UploadBox";
import type { RendererProps } from "./types";

export function Photo(props: RendererProps) {
  return <UploadBox {...props} />;
}
