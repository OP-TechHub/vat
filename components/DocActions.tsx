"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
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

/** Column heading with the action legend under its title. */
export function DocHeading({ title, canWrite, className }: { title: string; canWrite: boolean; className?: string }) {
  return (
    <th className={className}>
      <div>{title}</div>
      <IconLegend icons={canWrite ? ["open", "upload", "replace", "remove"] : ["open"]} />
    </th>
  );
}

/**
 * Status pill and the action icons for one document slot: Open when held; for editors Upload when
 * empty, or Replace and Remove when held.
 */
export function DocActions({
  doc,
  canWrite,
  busy,
  onOpen,
  onPick,
  onRemove,
  yes = "Yes",
  no = "No",
  pillClass,
}: {
  doc: ReturnDocument | null | undefined;
  canWrite: boolean;
  busy?: boolean;
  onOpen: (doc: ReturnDocument) => void;
  onPick: () => void;
  onRemove: (doc: ReturnDocument) => void;
  yes?: string;
  no?: string;
  /** Pill class when no document is held (default warn). */
  pillClass?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={"pill " + (doc ? "pill-good" : (pillClass ?? "pill-warn"))}>{doc ? yes : no}</span>
      {doc && <IconButton icon="open" label={`Open ${doc.filename}`} onClick={() => onOpen(doc)} />}
      {canWrite &&
        (doc ? (
          <>
            <IconButton icon="replace" label="Replace" disabled={busy} onClick={onPick} />
            <IconButton icon="remove" label="Remove" danger disabled={busy} onClick={() => onRemove(doc)} />
          </>
        ) : (
          <IconButton icon="upload" label="Upload" disabled={busy} onClick={onPick} />
        ))}
    </div>
  );
}
