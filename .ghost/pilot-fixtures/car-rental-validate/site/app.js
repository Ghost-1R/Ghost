(function () {
  const form = document.getElementById("inquiry-form");
  const status = document.getElementById("form-status");
  if (!form || !status) return;

  const fields = ["inquiry-name", "inquiry-email", "inquiry-vehicle", "inquiry-pickup"];

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }

  function clearInvalid() {
    fields.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.removeAttribute("aria-invalid");
    });
  }

  function markInvalid(id) {
    const el = document.getElementById(id);
    if (el) {
      el.setAttribute("aria-invalid", "true");
      el.focus();
    }
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function isPickupNotPast(value) {
    if (!value) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const picked = new Date(value + "T00:00:00");
    return !Number.isNaN(picked.getTime()) && picked >= today;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearInvalid();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const vehicle = String(data.get("vehicle") || "").trim();
    const pickup = String(data.get("pickup") || "").trim();

    if (name.length < 2) {
      markInvalid("inquiry-name");
      setStatus("Enter a name with at least 2 characters.", "error");
      return;
    }
    if (!isValidEmail(email)) {
      markInvalid("inquiry-email");
      setStatus("Enter a valid email address.", "error");
      return;
    }
    if (!vehicle) {
      markInvalid("inquiry-vehicle");
      setStatus("Select a preferred vehicle.", "error");
      return;
    }
    if (!pickup) {
      markInvalid("inquiry-pickup");
      setStatus("Choose a pickup date.", "error");
      return;
    }
    if (!isPickupNotPast(pickup)) {
      markInvalid("inquiry-pickup");
      setStatus("Pickup date must be today or later.", "error");
      return;
    }

    // Intentionally local-only: no fetch, no mailto, no analytics.
    setStatus(
      "Inquiry validated locally. Nothing was transmitted (Pilot 01 sample).",
      "ok",
    );
  });
})();
