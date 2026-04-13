# GeoTIFF Terrain Integration

This document explains how to use the GeoTIFF terrain integration feature in the 3D model viewer.

## Overview

The GeoTIFF terrain integration allows you to:
- Load GeoTIFF files containing elevation data
- Apply the elevation data as terrain in the 3D scene
- Automatically position 3D models on the terrain surface
- Switch between custom terrain and default flat terrain

## Usage

### Accessing the Terrain Control

1. **Via UI Button**: Click the "Terrain Control" button in the left menu panel
2. **Via Keyboard**: Press `Ctrl+T` to toggle the terrain control panel

### Loading a GeoTIFF File

1. Open the terrain control panel
2. Click "Choose File" and select a GeoTIFF file (.tif or .tiff)
3. Click the "Load Terrain" button
4. Wait for the terrain to load (status will be shown)

### Supported GeoTIFF Formats

- **File extensions**: .tif, .tiff
- **Coordinate systems**: WGS84 (EPSG:4326) preferred
- **Data types**: Elevation/DEM (Digital Elevation Model) files
- **Size**: Recommended under 100MB for optimal performance

### TFW File Support

The system now supports TFW (TIFF World) files for accurate coordinate system:
- **Purpose**: Contains coordinate transformation parameters
- **Format**: 6-line text file with pixel size and origin coordinates
- **Usage**: Optional but recommended for accurate positioning
- **Priority**: TFW coordinates > GeoTIFF metadata > sample bounds

**TFW File Format:**
```
Line 1: Pixel size in X direction (map units/pixel)
Line 2: Rotation term for row (usually 0)
Line 3: Rotation term for column (usually 0)
Line 4: Pixel size in Y direction (map units/pixel, usually negative)
Line 5: X-coordinate of upper-left pixel center (map units)
Line 6: Y-coordinate of upper-left pixel center (map units)
```

### Coordinate System Handling

The system includes intelligent coordinate system detection:
- **Automatic Detection**: Reads GeoTIFF coordinate system metadata
- **Bounds Validation**: Ensures coordinates are within valid geographic ranges
- **Sample Fallback**: Uses Barcelona area coordinates when system lacks proper CS
- **User Feedback**: Clear messages when sample coordinates are used

If your GeoTIFF shows sample coordinates (2.0°-2.3°E, 41.3°-41.5°N), it means:
- Original file lacks proper coordinate system information
- System is using sample area for demonstration
- Elevation data is still applied but with sample geographic bounds

### Terrain Information

After loading a GeoTIFF, the panel will display:
- **Bounds**: Geographic extent (west, south, east, north)
- **Dimensions**: Pixel dimensions of the GeoTIFF
- **Elevation Range**: Minimum and maximum elevation values
- **Status**: Current terrain state

### Resetting Terrain

To return to the default flat terrain:
1. Click the "Reset to Default" button in the terrain control panel
2. The scene will revert to the original Ellipsoid terrain

## Technical Details

### Integration with 3D Models

When GeoTIFF terrain is loaded:
- All 3D models are automatically positioned on the terrain surface
- Model height offsets are added to terrain elevation
- Both individual models and repetition models are supported
- Area textures follow terrain contours

### Terrain Provider

The system uses a custom Cesium terrain provider that:
- Samples elevation data from the loaded GeoTIFF
- Provides terrain tiles at multiple detail levels
- Handles coordinate transformations automatically
- Works with the existing model positioning system

### Performance Considerations

- Larger GeoTIFF files may take longer to load
- Terrain sampling is optimized for real-time rendering
- Models are repositioned automatically when terrain changes
- Memory usage increases with terrain complexity

## Troubleshooting

### Common Issues

1. **"Failed to load GeoTIFF"**
   - Check file format (must be .tif or .tiff)
   - Verify file contains elevation data
   - Ensure file size is reasonable (< 200MB)
   - **Library Loading**: The system now includes a local GeoTIFF parser with CDN fallbacks

2. **"Terrain not applied"**
   - Check browser console for error messages
   - Verify GeoTIFF has valid coordinate system
   - Try refreshing the page and reloading
   - **Fallback Mode**: If library fails, system uses sample terrain data

3. **Models not positioned correctly**
   - Ensure terrain is fully loaded before adding models
   - Check if models are within terrain bounds
   - Verify coordinate system compatibility
   - **Sample Terrain**: In fallback mode, uses Barcelona region coordinates

### Library Loading Issues Resolved

The system now includes multiple fallback mechanisms:
- **Primary**: Local geotiff.js library (included)
- **Secondary**: Multiple CDN sources (unpkg, jsdelivr, cdnjs)
- **Fallback**: Built-in sample terrain generator

This ensures the feature works even when:
- Internet connection is unavailable
- CDN services are down
- External libraries fail to load

### Stack Overflow Issues Fixed

Recent updates have resolved stack overflow errors:
- **Safe Array Processing**: Replaced spread operators with iteration
- **Memory Management**: Added bounds checking for large arrays
- **Error Handling**: Graceful fallbacks for invalid data
- **Data Validation**: Checks for NaN and infinite values

The system now handles:
- Large GeoTIFF files without stack overflow
- Invalid elevation data gracefully
- Memory-intensive operations safely
- Edge cases in terrain processing

### Terrain Provider Interface Issues Fixed

The terrain provider implementation has been corrected:
- **Proper Interface**: Uses Cesium-compatible terrain provider structure
- **No Constructor Issues**: Avoids calling abstract Cesium classes directly
- **Simple Fallback**: Provides basic elevation provider when complex terrain fails
- **Graceful Degradation**: Multiple levels of fallback ensure functionality

### Hidden Terrain Approach

To prevent terrain from covering background imagery:
- **Elevation-Only Mode**: GeoTIFF affects model positioning but doesn't render visually
- **Default Visual Terrain**: Keeps standard ellipsoid terrain for appearance
- **Background Imagery Visible**: Maps and satellite imagery show through clearly
- **Model Positioning**: 3D models positioned using GeoTIFF elevation data

**How It Works:**
1. **GeoTIFF Data Loaded**: Elevation data parsed and stored
2. **Visual Terrain Disabled**: GeoTIFF terrain not applied to scene visually
3. **Elevation Queries Active**: Models query terrain manager for elevation
4. **Background Preserved**: Standard terrain provider maintains visual appearance

**Visual Result**: Background maps remain completely visible while models are positioned on GeoTIFF terrain elevation

### Browser Compatibility

- **Chrome**: Full support
- **Firefox**: Full support  
- **Edge**: Full support
- **Safari**: Support with limitations

### Console Logging

Enable debug mode to see detailed terrain information:
```javascript
window.globalDebugConfig.modelRenderer.enabled = true;
```

## API Reference

### Terrain Manager

```javascript
// Load GeoTIFF terrain
await window.terrainManager.loadGeoTIFFTerrain(file, cesiumScene);

// Reset to default terrain
window.terrainManager.resetToDefaultTerrain(cesiumScene);

// Get elevation at coordinates
const elevation = window.terrainManager.getElevation(lon, lat);
```

### GeoTIFF Provider

```javascript
// Access loaded terrain data
const provider = window.terrainManager.geoTIFFProvider;
const info = provider.getTerrainInfo();
const bounds = provider.bounds;
```

## File Requirements

### Ideal GeoTIFF Properties

- **Coordinate System**: WGS84 (EPSG:4326)
- **Data Type**: Float32 or Float64
- **No Data Value**: Properly defined
- **Compression**: Uncompressed or LZW
- **Tile Organization**: Tiled or stripped

### Example GeoTIFF Sources

- **SRTM DEM**: Shuttle Radar Topography Mission data
- **ASTER GDEM**: Advanced Spaceborne Thermal Emission data
- **LiDAR DEM**: High-resolution local elevation data
- **National Elevation Datasets**: Country-specific DEM sources

## Future Enhancements

Planned improvements include:
- Support for additional coordinate systems
- Multiple terrain layer management
- Terrain editing capabilities
- Export terrain-modified models
- Terrain analysis tools
