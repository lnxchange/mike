import React from "react";
import mark from "../../../../../frontend/public/brand/libris-li-icon.png";

/** The Libris Li mark, used where the pane previously showed the Mike asterisk. */
export function LibrisMark({
  size,
  spin = false,
}: {
  size: number;
  spin?: boolean;
}): React.ReactElement {
  return (
    <img
      src={mark}
      alt=""
      width={size}
      height={size}
      className={spin ? "animate-spin" : undefined}
    />
  );
}
