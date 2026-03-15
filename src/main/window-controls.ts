import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MainDom } from "./dom";

export interface WindowControlsOptions {
  dom: MainDom;
  onBeforeUnload: () => void;
}

export function setupGlobalInteractionGuards() {
  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
    }
  });
}

export function setupWindowAndModalControls(options: WindowControlsOptions) {
  const { dom, onBeforeUnload } = options;

  dom.toggleKeyBtn.addEventListener("click", () => {
    dom.apiKeyInput.type = dom.apiKeyInput.type === "password" ? "text" : "password";
  });

  const openApiKeyHelpModal = () => {
    dom.apiKeyHelpModal.removeAttribute("hidden");
    document.body.classList.add("modal-open");
  };

  const closeApiKeyHelpModal = () => {
    dom.apiKeyHelpModal.setAttribute("hidden", "");
    document.body.classList.remove("modal-open");
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
