import mongoose from 'mongoose';

/**
 * Singleton platform settings (one document, key = "default").
 * Holds the default take-rate applied when an org has no fee override.
 */
const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    /** Default platform fee in basis points (500 = 5%). */
    defaultPlatformFeeBps: {
      type: Number,
      required: true,
      default: 500,
      min: 0,
      max: 10_000,
    },
  },
  { timestamps: true }
);

export const PlatformSettings =
  mongoose.models.PlatformSettings ||
  mongoose.model('PlatformSettings', platformSettingsSchema);
