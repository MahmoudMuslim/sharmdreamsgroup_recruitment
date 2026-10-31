"use client";

import type { PublicField } from "@/modules/form-builder/application/publicForm";
import { Address } from "./Address";
import { Checkbox } from "./Checkbox";
import { Currency } from "./Currency";
import { DateField } from "./DateField";
import { DateTimeField } from "./DateTimeField";
import { Duration } from "./Duration";
import { Email } from "./Email";
import { File } from "./File";
import { Geolocation } from "./Geolocation";
import { LongText } from "./LongText";
import { MultiSelect } from "./MultiSelect";
import { NumberField } from "./NumberField";
import { Percentage } from "./Percentage";
import { Phone } from "./Phone";
import { Photo } from "./Photo";
import { Radio } from "./Radio";
import { SectionHeading } from "./SectionHeading";
import { Select } from "./Select";
import { ShortText } from "./ShortText";
import { TimeField } from "./TimeField";
import { Url } from "./Url";
import type { UploadDoor, T } from "./types";

/**
 * The one switch (spec "Approaches considered" C). Every renderer receives the
 * same projected vocabulary, never a `system_key` or a field's full config, so
 * a new type is one file and one case.
 */
export function FieldRenderer({
  field,
  id,
  value,
  onChange,
  error,
  upload,
  t,
}: {
  field: PublicField;
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string | null;
  upload: UploadDoor;
  t: T;
}) {
  const props = {
    id,
    label: field.label,
    help: field.help,
    placeholder: field.placeholder,
    required: field.required,
    options: field.options,
    accept: field.accept,
    maxBytes: field.maxBytes,
    units: field.units,
    value,
    onChange,
    error,
    upload,
    t,
  };

  switch (field.type) {
    case "short_text":
      return <ShortText {...props} />;
    case "long_text":
      return <LongText {...props} />;
    case "email":
      return <Email {...props} />;
    case "phone":
      return <Phone {...props} />;
    case "url":
      return <Url {...props} />;
    case "number":
      return <NumberField {...props} />;
    case "percentage":
      return <Percentage {...props} />;
    case "currency":
      return <Currency {...props} />;
    case "date":
      return <DateField {...props} />;
    case "time":
      return <TimeField {...props} />;
    case "datetime":
      return <DateTimeField {...props} />;
    case "duration":
      return <Duration {...props} />;
    case "select":
      return <Select {...props} />;
    case "radio":
      return <Radio {...props} />;
    case "multi_select":
      return <MultiSelect {...props} />;
    case "checkbox":
      return <Checkbox {...props} />;
    case "file":
      return <File {...props} />;
    case "photo":
      return <Photo {...props} />;
    case "address":
      return <Address {...props} />;
    case "geolocation":
      return <Geolocation {...props} />;
    case "section_heading":
      return <SectionHeading {...props} />;
    default: {
      const unreachable: never = field.type;
      return unreachable;
    }
  }
}
