import type { VercelRequest, VercelResponse } from '@vercel/node';

// Locker sizes (same as in your app)
const LOCKER_SIZES = {
  small: { length: 385, width: 500, height: 110.2, label: "SMALL" },
  medium: { length: 385, width: 500, height: 222.2, label: "MEDIUM" },
  large: { length: 385, width: 500, height: 301, label: "LARGE" },
} as const;

type LockerKey = keyof typeof LOCKER_SIZES;

interface ParcelMeasurements {
  length_mm: number;
  width_mm: number;
  height_mm: number;
}

interface LockerRecommendation {
  size: string;
  fits: boolean;
  dimensions: ParcelMeasurements;
  lockerSpecs: {
    length_mm: number;
    width_mm: number;
    height_mm: number;
  };
  reason: string;
}

function recommendLocker(lenMM: number, widMM: number, htMM: number): LockerRecommendation {
  // Orientation allowed: footprint must satisfy min<=385 and max<=500
  const a = Math.min(lenMM, widMM);
  const b = Math.max(lenMM, widMM);
  const footprintFits = a <= LOCKER_SIZES.small.length && b <= LOCKER_SIZES.small.width;

  if (!footprintFits) {
    return {
      size: "TOO_LARGE",
      fits: false,
      dimensions: { length_mm: lenMM, width_mm: widMM, height_mm: htMM },
      lockerSpecs: { length_mm: LOCKER_SIZES.small.length, width_mm: LOCKER_SIZES.small.width, height_mm: LOCKER_SIZES.small.height },
      reason: "Parcel footprint exceeds maximum locker dimensions (385×500mm)"
    };
  }

  const ordered = ["small", "medium", "large"] as const;
  for (const key of ordered) {
    const spec = LOCKER_SIZES[key];
    if (htMM <= spec.height) {
      return {
        size: spec.label,
        fits: true,
        dimensions: { length_mm: lenMM, width_mm: widMM, height_mm: htMM },
        lockerSpecs: { length_mm: spec.length, width_mm: spec.width, height_mm: spec.height },
        reason: `Fits in ${spec.label} locker (height: ${htMM.toFixed(1)}mm ≤ ${spec.height}mm)`
      };
    }
  }

  return {
    size: "TOO_TALL",
    fits: false,
    dimensions: { length_mm: lenMM, width_mm: widMM, height_mm: htMM },
    lockerSpecs: { length_mm: LOCKER_SIZES.large.length, width_mm: LOCKER_SIZES.large.width, height_mm: LOCKER_SIZES.large.height },
    reason: `Height exceeds LARGE locker capacity (${htMM.toFixed(1)}mm > ${LOCKER_SIZES.large.height}mm)`
  };
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS for mobile app integration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { measurements, metadata } = req.body;

    // Validate input
    if (!measurements || 
        typeof measurements.length_mm !== 'number' ||
        typeof measurements.width_mm !== 'number' ||
        typeof measurements.height_mm !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Invalid measurements. Expected: { length_mm: number, width_mm: number, height_mm: number }'
      });
    }

    const { length_mm, width_mm, height_mm } = measurements;

    // Validate positive values
    if (length_mm <= 0 || width_mm <= 0 || height_mm <= 0) {
      return res.status(400).json({
        success: false,
        error: 'All dimensions must be positive numbers'
      });
    }

    // Get locker recommendation
    const recommendation = recommendLocker(length_mm, width_mm, height_mm);

    // Log the request for analytics (optional)
    console.log('Parcel measurement request:', {
      measurements,
      recommendation: recommendation.size,
      timestamp: new Date().toISOString(),
      ...metadata
    });

    return res.status(200).json({
      success: true,
      lockerRecommendation: recommendation,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing parcel measurement:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}
