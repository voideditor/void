/**
 * Represents an image attachment supplied by the user.
 */
export interface Attachment {
  /** Local identifier used for rendering and removal. */
  id: string;
  /** Original file name, if available. */
  name: string;
  /** MIME type of the image, e.g. `image/png`. */
  mime: string;
  /** Optional size in bytes. */
  size?: number;
  /** Data encoded as a data URL (base64). */
  dataUrl: string;
}
