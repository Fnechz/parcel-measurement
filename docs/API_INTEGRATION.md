# Parcel Measurement API Integration Guide

## Overview
This API provides locker size recommendations based on parcel dimensions. It's designed to integrate with your Android app for automated locker selection.

## Base URL
```
https://parcel-measurement-ne3k.vercel.app/api
```

## Endpoints

### 1. Test Endpoint
**GET** `/test`

Test if the API is working.

**Response:**
```json
{
  "success": true,
  "message": "Parcel Measurement API is working!",
  "timestamp": "2024-01-15T10:30:00Z",
  "endpoints": {
    "POST /api/measure-parcel": "Get locker recommendation from measurements",
    "GET /api/test": "Test endpoint"
  }
}
```

### 2. Measure Parcel
**POST** `/measure-parcel`

Get locker recommendation from parcel dimensions.

**Request Body:**
```json
{
  "measurements": {
    "length_mm": 250.5,
    "width_mm": 180.2,
    "height_mm": 95.8
  },
  "metadata": {
    "user_id": "user123",
    "session_id": "session456",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

**Response:**
```json
{
  "success": true,
  "lockerRecommendation": {
    "size": "SMALL",
    "fits": true,
    "dimensions": {
      "length_mm": 250.5,
      "width_mm": 180.2,
      "height_mm": 95.8
    },
    "lockerSpecs": {
      "length_mm": 385,
      "width_mm": 500,
      "height_mm": 110.2
    },
    "reason": "Fits in SMALL locker (height: 95.8mm ≤ 110.2mm)"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Locker Sizes
- **SMALL**: 385×500×110.2mm
- **MEDIUM**: 385×500×222.2mm  
- **LARGE**: 385×500×301mm

## Integration Options

### Option 1: WebView Integration (Recommended)
1. Open the web app in a WebView: `https://parcel-measurement-ne3k.vercel.app/`
2. User completes measurement manually
3. Add a "Send to App" button that posts results back to Android
4. Android receives the measurements via JavaScript bridge

### Option 2: Direct API Integration
1. Android app captures images
2. User manually enters measurements in Android app
3. Android app calls the API with measurements
4. Display locker recommendation

### Option 3: Hybrid Approach
1. Android app opens web app for measurement
2. Web app has "Send to App" functionality
3. Results are sent back to Android app

## Android Integration Example

### Kotlin/Java Example
```kotlin
data class ParcelMeasurements(
    val length_mm: Double,
    val width_mm: Double,
    val height_mm: Double
)

data class LockerRecommendation(
    val size: String,
    val fits: Boolean,
    val dimensions: ParcelMeasurements,
    val lockerSpecs: LockerSpecs,
    val reason: String
)

data class LockerSpecs(
    val length_mm: Double,
    val width_mm: Double,
    val height_mm: Double
)

// API call example
suspend fun getLockerRecommendation(measurements: ParcelMeasurements): LockerRecommendation {
    val requestBody = JSONObject().apply {
        put("measurements", JSONObject().apply {
            put("length_mm", measurements.length_mm)
            put("width_mm", measurements.width_mm)
            put("height_mm", measurements.height_mm)
        })
        put("metadata", JSONObject().apply {
            put("user_id", getCurrentUserId())
            put("timestamp", System.currentTimeMillis())
        })
    }
    
    val response = httpClient.post("https://parcel-measurement-ne3k.vercel.app/api/measure-parcel") {
        contentType(ContentType.Application.Json)
        setBody(requestBody.toString())
    }
    
    return Json.decodeFromString<LockerRecommendation>(response.bodyAsText())
}
```

## Error Handling
The API returns appropriate HTTP status codes:
- `200`: Success
- `400`: Bad Request (invalid measurements)
- `405`: Method Not Allowed
- `500`: Internal Server Error

Error responses include a `success: false` field and an `error` message.

## CORS
The API includes CORS headers to allow requests from mobile apps and web browsers.
