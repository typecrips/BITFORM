export type LocalImage = {
  file: File
  name: string
  url: string
  width: number
  height: number
}

/**
 * Browser-only image loading boundary. Future Canvas/OffscreenCanvas effects
 * can live in this module without coupling processing code to React views.
 */
export async function loadLocalImage(file: File): Promise<LocalImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }

  const url = URL.createObjectURL(file)
  try {
    const dimensions = await getImageDimensions(url)
    return { file, name: file.name, url, ...dimensions }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('That image could not be opened. Try a different file.')
  }
}

export function disposeLocalImage(image: LocalImage) {
  URL.revokeObjectURL(image.url)
}

function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = reject
    image.src = url
  })
}
