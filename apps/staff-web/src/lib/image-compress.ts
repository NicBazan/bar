/**
 * Optimización de archivos antes de subirlos a la API.
 *
 * - Imágenes (JPG, PNG, WebP): se redimensionan a un máximo de 1600px y se comprimen
 *   al 82% en el navegador (vía Canvas). Una foto pesada de 10-20 MB pasa a 200-400 KB
 *   de forma instantánea sin pérdida visible de calidad.
 * - Modelos 3D (GLB, USDZ): se valida que no superen los 4 MB para respetar el límite
 *   de 4.5 MB de Vercel Serverless.
 */

const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.82;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

export async function optimizeUploadFile(file: File): Promise<File> {
  if (typeof window === "undefined") return file;

  // 1. Modelos 3D: no se pueden recomprimir en Canvas, se valida el tamaño
  const is3D = /\.(glb|usdz)$/i.test(file.name) || file.type.includes("gltf") || file.type.includes("model");
  if (is3D) {
    if (file.size > MAX_UPLOAD_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(`El modelo 3D pesa ${mb} MB y supera el límite de 4 MB permitido. Reducí sus texturas o polígonos.`);
    }
    return file;
  }

  // 2. Si no es imagen, se valida el tamaño máximo
  if (!file.type.startsWith("image/")) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error("El archivo supera el límite de 4 MB.");
    }
    return file;
  }

  // 3. Comprimir y redimensionar imagen en el navegador
  return new Promise<File>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let { width, height } = img;

        // Escalar conservando aspect ratio si supera el máximo
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
            width = MAX_IMAGE_DIMENSION;
          } else {
            width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
            height = MAX_IMAGE_DIMENSION;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          // Si falla el contexto 2D, fallback al archivo original
          return resolve(file);
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        // Exportar como JPEG (compatible y muy liviano)
        canvas.toBlob(
          (blob) => {
            if (!blob) return resolve(file);
            // Solo usar el comprimido si realmente redujo el peso
            if (blob.size < file.size) {
              const baseName = file.name.replace(/\.[^.]+$/, "");
              const compressedFile = new File([blob], `${baseName}.jpg`, {
                type: "image/jpeg",
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          IMAGE_QUALITY,
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
}
