import {
  closeModal,
  createIcon,
  openModal,
  setupContextMenuGuard,
} from "@goblin-systems/goblin-design-system";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MainDom } from "./dom";

export interface WindowControlsOptions {
  dom: MainDom;
  onBeforeUnload: () => void;
}

export function setupGlobalInteractionGuards() {
  setupContextMenuGuard();

  window.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
    }
  });
}

export function setupWindowAndModalControls(options: WindowControlsOptions) {
  const { dom, onBeforeUnload } = options;

  dom.toggleKeyBtn.addEventListener("click", () => {
    const showingKey = dom.apiKeyInput.type === "text";
    dom.apiKeyInput.type = showingKey ? "password" : "text";
    const icon = createIcon(showingKey ? "eye" : "eye-off");
    if (icon) {
      dom.toggleKeyBtn.replaceChildren(icon);
    }
  });

  const openApiKeyHelpModal = () => {
    openModal({
      backdrop: dom.apiKeyHelpModal,
    });
  };

  const closeApiKeyHelpModal = () => {
    closeModal({
      backdrop: dom.apiKeyHelpModal,
    });
  };

  dom.apiKeyHelpBtn.addEventListener("click", openApiKeyHelpModal);
  dom.closeApiKeyHelpBtn.addEventListener("click", closeApiKeyHelpModal);
  dom.apiKeyHelpModal.addEventListener("click", (event) => {
    if (event.target === dom.apiKeyHelpModal) {
      closeApiKeyHelpModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.apiKeyHelpModal.hasAttribute("hidden")) {
      closeApiKeyHelpModal();
    }
  });

  dom.windowMinimizeBtn?.addEventListener("click", async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.error("Failed to minimize window:", err);
    }
  });

  dom.windowCloseBtn.addEventListener("click", async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error("Failed to close window:", err);
    }
  });

  window.addEventListener("beforeunload", onBeforeUnload);
}
