import multer from 'multer';
import { ValidationError } from '../core/errors.js';

// Configure multer to store files in memory.
// This is useful if you plan to process the file (e.g., resize) or upload it to a cloud service.
const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/x-icon',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
]);

// Magic bytes (file signatures) for supported formats.
// This prevents MIME type spoofing by checking actual file content.
const magicNumbers = {
  jpeg: [0xFF, 0xD8, 0xFF],
  png: [0x89, 0x50, 0x4E, 0x47],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF header for WebP
  ico: [0x00, 0x00, 0x01, 0x00], // ICO header
  svg: [0x3C, 0x73, 0x76, 0x67], // '<svg' in ASCII
  webm: [0x1A, 0x45, 0xDF, 0xA3],
  avi: [0x52, 0x49, 0x46, 0x46],
};

const validateFileMagicBytes = (buffer, mimeType) => {
  const bytes = buffer.slice(0, 4);

  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
    return bytes[0] === magicNumbers.jpeg[0] &&
      bytes[1] === magicNumbers.jpeg[1] &&
      bytes[2] === magicNumbers.jpeg[2];
  }

  if (mimeType.includes('png')) {
    return bytes[0] === magicNumbers.png[0] &&
      bytes[1] === magicNumbers.png[1] &&
      bytes[2] === magicNumbers.png[2] &&
      bytes[3] === magicNumbers.png[3];
  }

  if (mimeType.includes('webp')) {
    // For WebP, check RIFF signature and WEBP fourcc.
    const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 &&
      bytes[2] === 0x46 && bytes[3] === 0x46;
    if (isRiff && buffer.length > 12) {
      const webpSignature = buffer.slice(8, 12).toString('ascii');
      return webpSignature === 'WEBP';
    }
    return false;
  }

  if (mimeType.includes('icon') || mimeType.includes('x-icon')) {
    // For ICO, check the header.
    return bytes[0] === magicNumbers.ico[0] &&
      bytes[1] === magicNumbers.ico[1] &&
      bytes[2] === magicNumbers.ico[2] &&
      bytes[3] === magicNumbers.ico[3];
  }

  if (mimeType.includes('svg+xml')) {
    // Allow an XML declaration or whitespace before the root SVG element.
    return /^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(buffer.toString('utf8', 0, Math.min(buffer.length, 512)));
  }

  if (mimeType.startsWith('video/')) {
    // Common video containers: MP4/QuickTime uses 'ftyp' after the first 4 bytes,
    // WebM/Matroska starts with the EBML signature, and AVI starts with RIFF/AVI.
    if (buffer.length >= 12 && bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
      return true;
    }

    const hasRiffHeader = bytes[0] === magicNumbers.avi[0] &&
      bytes[1] === magicNumbers.avi[1] &&
      bytes[2] === magicNumbers.avi[2] &&
      bytes[3] === magicNumbers.avi[3];
    if (hasRiffHeader && buffer.length > 12) {
      return buffer.slice(8, 12).toString('ascii') === 'AVI ';
    }

    const ftypIndex = buffer.indexOf(Buffer.from('ftyp'));
    return ftypIndex !== -1;
  }

  return false;
};

const fileFilter = (req, file, cb) => {
  if (!file.mimetype || !allowedMimeTypes.has(file.mimetype.toLowerCase())) {
    return cb(new ValidationError('Only JPG, PNG, WEBP images, or common video files are allowed.', { file: 'Invalid file type' }), false);
  }

  cb(null, true);
};

const videoFileFilter = (req, file, cb) => {
  if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('video/')) {
    return cb(new ValidationError('Only video files are allowed for video uploads.', { file: 'Invalid video type' }), false);
  }

  cb(null, true);
};

const validateUploadedFiles = (req) => {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  if (req.files && !Array.isArray(req.files)) {
    Object.values(req.files).forEach((fieldFiles) => files.push(...fieldFiles));
  }

  for (const file of files) {
    if (!file.buffer || !validateFileMagicBytes(file.buffer, file.mimetype)) {
      throw new ValidationError('File content does not match the declared type. Possible file type spoofing detected.', { file: 'Invalid file' });
    }
  }
};

const withContentValidation = (middleware) => (req, res, next) => {
  middleware(req, res, (error) => {
    if (error) return next(error);
    try {
      validateUploadedFiles(req);
      next();
    } catch (validationError) {
      next(validationError);
    }
  });
};

const multerUpload = multer({ storage, fileFilter, limits: { fileSize: 1024 * 1024 * 5 } });
const multerVideoUpload = multer({
  storage,
  fileFilter: videoFileFilter,
  limits: { fileSize: 1024 * 1024 * 300, files: 1 },
});

export const upload = {
  single: (field) => withContentValidation(multerUpload.single(field)),
  array: (field, maxCount) => withContentValidation(multerUpload.array(field, maxCount)),
  videoArray: (field) => withContentValidation(multerVideoUpload.array(field, 1)),
  fields: (fields) => withContentValidation(multerUpload.fields(fields)),
};

