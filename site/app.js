// Site behaviour — external file so the CSP can forbid inline scripts.
document.addEventListener("DOMContentLoaded", function () {
  // Mobile menu toggle
  var toggle = document.querySelector(".menu-toggle");
  var nav = document.querySelector("nav.links");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", nav.classList.contains("open") ? "true" : "false");
    });
  }

  // Secure contact form: submits over HTTPS in the background, shows the
  // result in-page. Falls back to a normal (still HTTPS) form post when JS
  // is unavailable.
  var form = document.getElementById("contact-form");
  var status = document.getElementById("form-status");
  if (form && status) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var accessKey = form.querySelector('input[name="access_key"]');
      if (!accessKey || accessKey.value.indexOf("YOUR-") === 0) {
        status.hidden = false;
        status.style.color = "#ce2b37";
        status.textContent =
          "The contact form isn't activated yet — please email us directly at info@rsmotocons.com.";
        return;
      }

      var button = form.querySelector('button[type="submit"]');
      var originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "Sending…";
      status.hidden = true;

      var data = Object.fromEntries(new FormData(form).entries());
      // Checkbox → readable value in the email
      data.marketingOptIn = form.querySelector("#optin").checked ? "Yes" : "No";

      fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (res) { return res.json(); })
        .then(function (res) {
          status.hidden = false;
          if (res.success) {
            status.style.color = "#009246";
            status.textContent = "Thanks — your message has been sent. We'll reply within one business day.";
            form.reset();
          } else {
            status.style.color = "#ce2b37";
            status.textContent = "Something went wrong sending your message. Please email info@rsmotocons.com instead.";
          }
        })
        .catch(function () {
          status.hidden = false;
          status.style.color = "#ce2b37";
          status.textContent = "Network problem — please try again, or email info@rsmotocons.com.";
        })
        .finally(function () {
          button.disabled = false;
          button.textContent = originalLabel;
        });
    });
  }
});
