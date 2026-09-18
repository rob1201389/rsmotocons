// Member Hub — customer message inbox.
// Messages are decrypted server-side only after Cloudflare Access has
// verified the visitor; this script just displays them.
document.addEventListener("DOMContentLoaded", function () {
  var box = document.getElementById("inbox");
  if (!box) return;

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function note(html, color) {
    box.innerHTML = '<p style="color:' + (color || "var(--muted)") + ';font-size:.95rem">' + html + "</p>";
  }

  function load() {
    note("Loading messages…");
    fetch("/members/api/leads", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.success) {
          if (res.error === "locked") {
            note("⚠️ The members lock (Cloudflare Access) isn't switched on yet, so the inbox stays closed for safety. Finish the lock setup and reload this page.", "#ce2b37");
          } else {
            note("⚠️ " + esc(res.error || "The inbox isn't set up yet."), "#ce2b37");
          }
          return;
        }
        if (!res.items.length) {
          note("No customer messages yet. New enquiries from the website will appear here.");
          return;
        }
        box.innerHTML = res.items.map(function (m) {
          if (m.error) {
            return '<div class="msg"><p style="color:#ce2b37">' + esc(m.error) + "</p></div>";
          }
          var when = m.receivedAt ? new Date(m.receivedAt).toLocaleString() : "";
          return (
            '<div class="msg">' +
            '<div class="msg-head"><b>' + esc(m.name) + "</b><span>" + esc(when) + "</span></div>" +
            '<p class="msg-meta"><a href="mailto:' + esc(m.email) + '">' + esc(m.email) + "</a>" +
            (m.department ? " · " + esc(m.department) : "") +
            (m.marketingOptIn ? ' · <span class="ok">opted in to updates</span>' : "") +
            "</p>" +
            (m.message ? "<p>" + esc(m.message) + "</p>" : "") +
            '<button class="del" data-id="' + esc(m.id) + '">Delete</button>' +
            "</div>"
          );
        }).join("");
        box.querySelectorAll("button.del").forEach(function (btn) {
          btn.addEventListener("click", function () {
            if (!confirm("Delete this message permanently?")) return;
            btn.disabled = true;
            fetch("/members/api/leads/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
              body: JSON.stringify({ id: btn.getAttribute("data-id") }),
            }).then(load);
          });
        });
      })
      .catch(function () { note("Could not load messages — check your connection and reload.", "#ce2b37"); });
  }

  load();
});
