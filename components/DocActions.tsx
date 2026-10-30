"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Perm } from "@/lib/permissions";
import type { ReturnDocument } from "@/lib/types";

export type IconName = "open" | "upload" | "replace" | "remove";

const PATHS: Record<IconName, ReactNode> = {
  open: (
    <>
      <path d="M14 3h7v7" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m6 10 6-6 6 6" />
      <path d="M4 20h16" />
    </>
  ),
  replace: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </>
  ),
  remove: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
};

export const ICON_LABEL: Record<IconName, string> = { open: "Open", upload: "Upload", replace: "Replace", remove: "Remove" };

export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Square icon-only button; the label goes to the tooltip and to screen readers. */
export function IconButton({
  icon,
  label,
  danger,
  className,
  ...rest
}: { icon: IconName; label: string; danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={"btn btn-icon" + (danger ? " btn-danger" : "") + (className ? " " + className : "")}
      title={label}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Icon legend for a column heading, so the buttons in the rows need no text. */
export function IconLegend({ icons }: { icons: IconName[] }) {
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-0.5 normal-case tracking-normal font-normal text-muted">
      {icons.map((i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <Icon name={i} size={12} />
          {ICON_LABEL[i]}
        </span>
      ))}
    </div>
  );
}

/** Document actions a permission allows: Upload into an empty slot, Replace (upload and delete), Remove. */
export function docIcons(perm: Perm): IconName[] {
  const icons: IconName[] = ["open"];
  if (perm.upload) icons.push("upload");
  if (perm.upload && perm.delete) icons.push("replace");
  if (perm.delete) icons.push("remove");
  return icons;
}

/** Column heading with the action legend under its title. */
export function DocHeading({ title, perm, className }: { title: string; perm: Perm; className?: string }) {
  return (
    <th className={className}>
      <div>{title}</div>
      <IconLegend icons={docIcons(perm)} />
    </th>
  );
}

/**
 * Status pill and the action icons for one document slot: Open when held; Upload when empty (upload
 * permission); Replace (upload and delete) and Remove (delete) when held.
 */
export function DocActions<T extends { filename: string } = ReturnDocument>({
  doc,
  perm,
  busy,
  onOpen,
  onPick,
  onRemove,
  yes = "Yes",
  no = "No",
  pillClass,
  showName,
}: {
  doc: T | null | undefined;
  perm: Perm;
  busy?: boolean;
  onOpen: (doc: T) => void;
  onPick: () => void;
  onRemove: (doc: T) => void;
  yes?: string;
  no?: string;
  /** Pill class when no document is held (default warn). */
  pillClass?: string;
  /** Print the held file's name beside the actions. */
  showName?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={"pill " + (doc ? "pill-good" : (pillClass ?? "pill-warn"))}>{doc ? yes : no}</span>
      {doc && <IconButton icon="open" label={`Open ${doc.filename}`} onClick={() => onOpen(doc)} />}
      {doc ? (
        <>
          {perm.upload && perm.delete && <IconButton icon="replace" label="Replace" disabled={busy} onClick={onPick} />}
          {perm.delete && <IconButton icon="remove" label="Remove" danger disabled={busy} onClick={() => onRemove(doc)} />}
        </>
      ) : (
        perm.upload && <IconButton icon="upload" label="Upload" disabled={busy} onClick={onPick} />
      )}
      {showName && doc && (
        <span className="text-[12px] text-muted truncate max-w-[180px]" title={doc.filename}>
          {doc.filename}
        </span>
      )}
    </div>
  );
}
