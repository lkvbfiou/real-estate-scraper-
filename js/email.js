const emailAddress = "investing@charter.net"; 

document.getElementById("emailButton").addEventListener("click", () => {
  document.getElementById("popup").style.display = "block";
});

function closePopup() {
  document.getElementById("popup").style.display = "none";
}

function openEmail(service) {
  let url = "";

  switch (service) {
    case "gmail":
      url = `https://mail.google.com/mail/?view=cm&fs=1&to=${emailAddress}`;
      break;
    case "outlook":
      url = `https://outlook.live.com/owa/?path=/mail/action/compose&to=${emailAddress}`;
      break;
    default:
      alert("Unknown service");
      return;
  }

  window.open(url, "_blank");
  closePopup();
}

function copyEmail() {
  const emailAddress = "investing@charter.net"; // Replace or grab from DOM
  const copyIcon = document.getElementById("copy");

  navigator.clipboard.writeText(emailAddress).then(() => {
    // Save original image source
    const originalSrc = copyIcon.src;

    // Change to the "copied" icon
    copyIcon.src = "https://static.thenounproject.com/png/835-200.png";

    setTimeout(() => {
      copyIcon.src = originalSrc;
    }, 1000);
  }).catch((err) => {
    console.error("Clipboard error:", err);
  });
}
