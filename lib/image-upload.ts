export interface ImageUploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;

async function compressImage(file: File, maxSize: number): Promise<File> {
  if (file.size <= maxSize) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = async () => {
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      let width = img.width;
      let height = img.height;

      const maxDimension = 2048;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const qualities = [0.8, 0.6, 0.4, 0.3, 0.2];

      for (const quality of qualities) {
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", quality)
        );

        if (blob && blob.size <= maxSize) {
          const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
          resolve(compressedFile);
          return;
        }
      }

      const scaleFactors = [0.75, 0.5, 0.25];
      for (const scale of scaleFactors) {
        const scaledWidth = Math.round(width * scale);
        const scaledHeight = Math.round(height * scale);
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
        ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", 0.7)
        );

        if (blob && blob.size <= maxSize) {
          const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
          resolve(compressedFile);
          return;
        }
      }

      const finalBlob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/jpeg", 0.5)
      );

      if (finalBlob) {
        const compressedFile = new File([finalBlob], file.name.replace(/\.[^.]+$/, ".jpg"), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
        resolve(compressedFile);
      } else {
        reject(new Error("Failed to compress image"));
      }
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadNoteImage(
  file: File,
  noteId: string
): Promise<ImageUploadResult> {
  try {
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      return {
        success: false,
        error: "Invalid file type. Only JPEG, PNG, GIF, and WebP images are supported.",
      };
    }

    let fileToUpload = file;
    if (file.size > MAX_FILE_SIZE) {
      try {
        fileToUpload = await compressImage(file, MAX_FILE_SIZE);
      } catch {
        return {
          success: false,
          error: "Failed to compress image. Please try a smaller file.",
        };
      }
    }

    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: fileToUpload.name,
        noteId: noteId,
        contentType: fileToUpload.type,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: "Failed to get upload URL",
      };
    }

    const { uploadURL, publicUrl } = await response.json();

    const uploadResponse = await fetch(uploadURL, {
      method: "PUT",
      body: fileToUpload,
      headers: {
        "Content-Type": fileToUpload.type,
      },
    });

    if (!uploadResponse.ok) {
      return {
        success: false,
        error: "Failed to upload file",
      };
    }

    return {
      success: true,
      url: publicUrl,
    };
  } catch (error) {
    console.error("Unexpected error during upload:", error);
    return {
      success: false,
      error: "An unexpected error occurred during upload.",
    };
  }
}

export function getImageFromClipboard(
  event: ClipboardEvent
): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.indexOf("image") !== -1) {
      return item.getAsFile();
    }
  }

  return null;
}

export function insertImageMarkdown(
  textarea: HTMLTextAreaElement,
  imageUrl: string,
  altText: string = "image"
): void {
  const cursorPos = textarea.selectionStart;
  const textBefore = textarea.value.substring(0, cursorPos);
  const textAfter = textarea.value.substring(cursorPos);

  const needsNewlineBefore = textBefore.length > 0 && !textBefore.endsWith("\n");
  const needsNewlineAfter = textAfter.length > 0 && !textAfter.startsWith("\n");

  const imageMarkdown = `${needsNewlineBefore ? "\n" : ""}![${altText}](${imageUrl})${needsNewlineAfter ? "\n" : ""}`;

  const newValue = textBefore + imageMarkdown + textAfter;
  textarea.value = newValue;

  const inputEvent = new Event("input", { bubbles: true });
  textarea.dispatchEvent(inputEvent);

  const newCursorPos = cursorPos + imageMarkdown.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  textarea.focus();
}
