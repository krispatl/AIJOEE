const serverURL = "";

window.addEventListener("DOMContentLoaded", function () {
  const messageInput = document.getElementById("messageInput");
  const sendMessageButton = document.getElementById("sendMessage");
  const conversationOutput = document.getElementById("conversationOutput");
  const talkButton = document.getElementById("talkButton");

  // Display messages in the chat box
  function displayMessage(sender, message) {
    const messageElement = document.createElement("p");
    messageElement.textContent = sender + ": " + message;
    conversationOutput.appendChild(messageElement);
    conversationOutput.scrollTop = conversationOutput.scrollHeight;
  }

  // Send user message to backend
  function sendMessage(userMessage) {
    displayMessage("You", userMessage);

    fetch(serverURL + "/api/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessage })
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.assistantResponse) {
          displayMessage("Joe Davis", data.assistantResponse);
          playAudioResponse(data.assistantResponse);
        } else {
          displayMessage("Joe Davis", "No response received.");
        }
      })
      .catch(function (err) {
        console.error("❌ Error sending message:", err);
        displayMessage("Joe Davis", "Error connecting to AI.");
      });
  }

  // Play audio from ElevenLabs response
async function playAudioResponse(text) {
  console.log("🗣️ Sending to TTS:", text);

  try {
    const res = await fetch(`${serverURL}/api/generate-audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (res.ok) {
      const blob = await res.blob();
      const audioURL = URL.createObjectURL(blob);
      const audio = new Audio(audioURL);

      // ⏯️ Play random animations while audio is playing
      let animationInterval;

      audio.addEventListener("play", () => {
        animationInterval = setInterval(() => {
          const randomAnim =
            window.avatarAnimations[
              Math.floor(Math.random() * window.avatarAnimations.length)
            ];
          window.playAnimation(randomAnim);
        }, 3000); // Change every 2.5s while speaking
      });

      // 🛑 Stop animations when audio ends
      audio.addEventListener("ended", () => {
        clearInterval(animationInterval);
        window.playAnimation("weight_shift"); // Return to neutral
      });

      audio.play();
    } else {
      const errText = await res.text();
      console.error("❗ TTS Error Response Body:", errText);
    }
  } catch (err) {
    console.error("❌ Error playing TTS:", err);
  }
}



  // Send button click
  sendMessageButton.addEventListener("click", function () {
    var userMessage = messageInput.value.trim();
    if (userMessage) {
      sendMessage(userMessage);
      messageInput.value = "";
    }
  });

  // Voice input logic
  talkButton.addEventListener("click", function () {
    console.log("🎙️ Talk button clicked — recording starting...");

    if (!navigator.mediaDevices) {
      alert("Mic not supported.");
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        const mediaRecorder = new MediaRecorder(stream);
        const audioChunks = [];

        mediaRecorder.ondataavailable = function (e) {
          if (e.data.size > 0) {
            audioChunks.push(e.data);
          }
        };

        mediaRecorder.onstop = function () {
          var audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          var formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");

          displayMessage("System", "🛠️ Transcribing...");

          fetch(serverURL + "/api/transcribe", {
            method: "POST",
            body: formData
          })
            .then(function (res) {
              return res.json();
            })
            .then(function (data) {
              console.log("📝 Transcription result:", data);
              if (data.text) {
                displayMessage("You (voice)", data.text);
                sendMessage(data.text);
              } else {
                displayMessage("System", "❌ Could not understand your voice.");
              }
            })
            .catch(function (err) {
              console.error("❌ Whisper error:", err);
              displayMessage("System", "⚠️ Transcription failed.");
            });

          stream.getTracks().forEach(function (track) {
            track.stop();
          });
        };

        mediaRecorder.start();
        displayMessage("System", "🎙️ Listening for 5 seconds...");

        setTimeout(function () {
          mediaRecorder.stop();
          displayMessage("System", "🛑 Stopped. Transcribing...");
        }, 5000);
      })
      .catch(function (err) {
        console.error("❌ Mic access error:", err);
        displayMessage("System", "⚠️ Mic access denied.");
      });
  });
});
