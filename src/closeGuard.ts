export interface CloseRequest {
  preventDefault(): void;
}

/**
 * Tauri destroys the window after onCloseRequested unless preventDefault ran.
 * A clean document must not prevent that. A dirty document asks first; Cancel,
 * a failed ask, or a second close while the ask is open keeps the window.
 */
export async function handleCloseRequest(
  event: CloseRequest,
  dirty: boolean,
  asking: boolean,
  askDiscard: () => Promise<boolean>,
): Promise<"close" | "stay"> {
  if (!dirty) return "close";
  if (asking) {
    event.preventDefault();
    return "stay";
  }
  let discard = false;
  try {
    discard = await askDiscard();
  } catch {
    discard = false;
  }
  if (!discard) {
    event.preventDefault();
    return "stay";
  }
  return "close";
}
