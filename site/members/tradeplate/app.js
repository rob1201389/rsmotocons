/**
 * Trade plate record of use — browser behaviour.
 * External file because the site's CSP forbids inline scripts.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    wireSignaturePads();
    wireNowButtons();
    wirePrintButtons();
    renderQrLabels();
  });

  /* ---------------------------------------------------------- signatures */

  function wireSignaturePads() {
    var pads = document.querySelectorAll("[data-sig]");
    Array.prototype.forEach.call(pads, function (canvas) {
      var name = canvas.getAttribute("data-sig");
      var input = document.querySelector('[data-sig-input="' + name + '"]');
      var hint = document.querySelector('[data-sig-hint="' + name + '"]');
      var clear = document.querySelector('[data-clear-sig="' + name + '"]');
      if (!input) return;

      var ctx = prepare(canvas);
      if (!ctx) return;

      var drawing = false;

      function prepare(c) {
        var rect = c.getBoundingClientRect();
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
        var g = c.getContext("2d");
        if (!g) return null;
        g.scale(dpr, dpr);
        g.lineWidth = 2.2;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.strokeStyle = "#21262c";
        return g;
      }

      function pos(e) {
        var r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }

      canvas.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        drawing = true;
        var p = pos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        // A tap alone should still leave a visible mark.
        ctx.lineTo(p.x + 0.1, p.y + 0.1);
        ctx.stroke();
      });

      canvas.addEventListener("pointermove", function (e) {
        if (!drawing) return;
        e.preventDefault();
        var p = pos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      });

      function end() {
        if (!drawing) return;
        drawing = false;
        input.value = canvas.toDataURL("image/png");
        if (hint) {
          hint.textContent = "Signature captured.";
          hint.className = "tp-hint";
        }
      }

      canvas.addEventListener("pointerup", end);
      canvas.addEventListener("pointercancel", end);
      canvas.addEventListener("pointerleave", end);

      if (clear) {
        clear.addEventListener("click", function () {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.restore();
          input.value = "";
          if (hint) {
            hint.textContent = "Sign with your finger";
            hint.className = "tp-hint";
          }
        });
      }

      // Redraw the backing store on rotate, keeping whatever is already drawn.
      window.addEventListener("orientationchange", function () {
        var existing = input.value;
        setTimeout(function () {
          ctx = prepare(canvas);
          if (ctx && existing) {
            var img = new Image();
            img.onload = function () {
              var rect = canvas.getBoundingClientRect();
              ctx.drawImage(img, 0, 0, rect.width, rect.height);
            };
            img.src = existing;
          }
        }, 200);
      });
    });
  }

  /* ------------------------------------------------------------ "Now" ---- */

  function wireNowButtons() {
    var buttons = document.querySelectorAll("[data-now-for]");
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener("click", function () {
        var field = document.getElementById(btn.getAttribute("data-now-for"));
        if (field) field.value = nswNow();
      });
    });
  }

  /** NSW local time as a datetime-local value, whatever the phone is set to. */
  function nswNow() {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Sydney",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date());
    function get(t) {
      var found = parts.filter(function (p) { return p.type === t; })[0];
      return found ? found.value : "00";
    }
    var hour = get("hour") === "24" ? "00" : get("hour");
    return get("year") + "-" + get("month") + "-" + get("day") + "T" + hour + ":" + get("minute");
  }

  /* ------------------------------------------------------------- printing */

  function wirePrintButtons() {
    var buttons = document.querySelectorAll("[data-print]");
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener("click", function () { window.print(); });
    });
  }

  /* ----------------------------------------------------------- QR labels */

  function renderQrLabels() {
    var boxes = document.querySelectorAll("[data-qr]");
    if (!boxes.length) return;

    // qrcode.min.js is loaded with defer on the label sheet only, so it may
    // not be ready on the first tick.
    var tries = 0;
    (function waitForLib() {
      if (typeof window.qrcode === "function") return draw(boxes);
      if (tries++ > 40) return fallback(boxes);
      setTimeout(waitForLib, 50);
    })();
  }

  function draw(boxes) {
    Array.prototype.forEach.call(boxes, function (box) {
      try {
        var qr = window.qrcode(0, "M");
        qr.addData(box.getAttribute("data-qr"));
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
      } catch (err) {
        box.textContent = box.getAttribute("data-qr");
        box.className += " tp-qr-fallback";
      }
    });
  }

  function fallback(boxes) {
    Array.prototype.forEach.call(boxes, function (box) {
      box.textContent = box.getAttribute("data-qr");
      box.className += " tp-qr-fallback";
    });
  }
})();
