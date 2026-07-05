const menuButton = document.querySelector("[data-menu-button]");
const mainNav = document.querySelector("#mainNav");
const installDialog = document.querySelector("#installDialog");
const installButtons = document.querySelectorAll("[data-install-app]");
let installPrompt = null;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}

function setMenu(open) {
  document.body.classList.toggle("menu-open", open);
  menuButton?.setAttribute("aria-expanded", String(open));
  if (menuButton) menuButton.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
}

menuButton?.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
mainNav?.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMenu(false);
    if (installDialog?.open) installDialog.close();
  }
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 820) setMenu(false);
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButtons.forEach((button) => button.removeAttribute("aria-disabled"));
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButtons.forEach((button) => {
    button.textContent = "RicoXP instalado";
    button.setAttribute("aria-disabled", "true");
  });
});

installButtons.forEach((button) => button.addEventListener("click", async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  installDialog?.showModal();
}));

document.querySelectorAll("[data-close-install]").forEach((button) => button.addEventListener("click", () => installDialog?.close()));
installDialog?.addEventListener("click", (event) => {
  const bounds = installDialog.getBoundingClientRect();
  const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (outside) installDialog.close();
});

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = document.querySelectorAll(".reveal");
if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("visible"));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -30px" });
  revealItems.forEach((item) => observer.observe(item));
}

document.querySelectorAll("[data-current-year]").forEach((item) => {
  item.textContent = String(new Date().getFullYear());
});