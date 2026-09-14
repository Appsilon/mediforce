'use client';

import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { Download, Maximize2, X } from 'lucide-react';
import { saveBlobToDevice } from '@/lib/save-blob';

const DOWNLOAD_SIZE_PX = 1024;

/**
 * QR code for a freshly minted join link, for putting in front of a room.
 *
 * Rendered in the browser on purpose: the URL carries the plaintext token, so
 * handing it to a hosted QR image service would leak the secret to a third
 * party. Always black on white — a dark-mode inverted code scans poorly.
 */
export function JoinLinkQr({
  url,
  handle,
  workspaceName,
}: {
  url: string;
  handle: string;
  workspaceName: string;
}) {
  const [presenting, setPresenting] = useState(false);
  const downloadCanvasRef = useRef<HTMLCanvasElement>(null);

  function handleDownload() {
    const canvas = downloadCanvasRef.current;
    if (canvas === null) return;
    canvas.toBlob((blob) => {
      if (blob !== null) saveBlobToDevice(blob, `join-${handle}.png`);
    }, 'image/png');
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <QRCodeSVG
        value={url}
        size={160}
        marginSize={4}
        role="img"
        aria-label="Join link QR code"
        className="rounded-md"
      />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setPresenting(true)}
          className="flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          <Maximize2 className="h-3 w-3" />
          Present
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          <Download className="h-3 w-3" />
          Download PNG
        </button>
      </div>

      <QRCodeCanvas
        ref={downloadCanvasRef}
        value={url}
        size={DOWNLOAD_SIZE_PX}
        marginSize={4}
        className="hidden"
        aria-hidden
      />

      <Dialog.Root open={presenting} onOpenChange={setPresenting}>
        <Dialog.Portal>
          <Dialog.Content className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-auto bg-white p-8 text-black">
            <Dialog.Title className="text-center text-3xl font-semibold sm:text-5xl">
              Join {workspaceName}
            </Dialog.Title>
            <Dialog.Description className="text-center text-lg text-neutral-600">
              Scan the code or open the link, then enter your email.
            </Dialog.Description>
            <QRCodeSVG
              value={url}
              size={512}
              role="img"
              aria-label="Join link QR code (presentation)"
              className="h-auto w-[min(60vh,80vw)]"
            />
            <p className="max-w-4xl break-all text-center font-mono text-base sm:text-xl">{url}</p>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close presentation"
                className="absolute right-4 top-4 rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-black transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
