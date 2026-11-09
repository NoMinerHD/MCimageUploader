const form = document.querySelector('#upload');
const input = document.querySelector('#image');
const button = form.querySelector('button');
const status = document.querySelector('#status');
const token = location.hash.slice(1);

if (!/^[a-f0-9]{48}$/.test(token)) {
  status.textContent = 'Öffne den Link aus dem Minecraft-Chat. Du erhältst ihn mit /image.';
} else {
  button.disabled = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      status.textContent = 'Die Datei ist größer als 2 MiB.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Das Bild wird hochgeladen …';
    try {
      const response = await fetch('/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (response.status === 201) {
        status.textContent = 'Upload abgeschlossen. In Minecraft siehst du, ob das Bild angewendet wurde.';
        input.disabled = true;
        return;
      }
      const messages = {
        404: 'Der Link ist abgelaufen. Gib in Minecraft erneut /image ein.',
        409: 'Für diesen Link läuft bereits ein Upload oder es wurde schon ein Bild hochgeladen.',
        413: 'Die Datei ist größer als 2 MiB.',
        415: 'Wähle eine PNG- oder JPG-Datei.',
      };
      status.textContent = messages[response.status] ?? 'Upload fehlgeschlagen. Versuche es erneut.';
    } catch {
      status.textContent = 'Der Upload-Dienst ist gerade nicht erreichbar. Versuche es erneut.';
    }
    button.disabled = false;
  });
}
