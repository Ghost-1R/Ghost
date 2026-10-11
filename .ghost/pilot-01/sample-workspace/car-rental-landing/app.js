(function () {
  const form = document.getElementById("inquiry-form");
  const status = document.getElementById("form-status");
  if (!form || !status) return;

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const vehicle = String(data.get("vehicle") || "").trim();
    const pickup = String(data.get("pickup") || "").trim();

    if (name.length < 2) {
      setStatus("Enter a name with at least 2 characters.", "error");
      return;
    }
    if (!isValidEmail(email)) {
      setStatus("Enter a valid email address.", "error");
      return;
    }
    if (!vehicle) {
      setStatus("Select a preferred vehicle.", "error");
      return;
    }
    if (!pickup) {
      setStatus("Choose a pickup date.", "error");
      return;
    }

    // Intentionally local-only: no fetch, no mailto, no analytics.
    setStatus(
      "Inquiry validated locally. Nothing was transmitted (Pilot 01 sample).",
      "ok",
    );
  });
})();
