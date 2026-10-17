import { isFiledEntity } from "@/modules/settings/domain/masterDataFiling";
import { readFilingDrift } from "@/modules/jobs/application/filingVocabularies";
import { FilingDriftDesk } from "./FilingDriftDesk";

/**
 * What this vocabulary does not recognise, read on the section that shows it.
 *
 * The read runs only when the dock is on one of the four lists an opening files
 * itself under — the rule the change trail already follows, because a section that
 * never shows a figure should not pay for it.
 */
export async function FilingDriftPanel({ entity }: { entity: string }) {
  if (!isFiledEntity(entity)) return null;
  const read = await readFilingDrift(entity);

  return (
    <FilingDriftDesk
      entity={entity}
      cards={read.cards}
      choices={read.destinations[entity] ?? []}
      openings={read.openings}
      note={read.note}
      warning={read.warning}
      error={read.error}
    />
  );
}
