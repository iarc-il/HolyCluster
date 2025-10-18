# HolyCluster User Manual

---

## Introduction

### What is the Holy Cluster?

The Holy Cluster is a modern graphical DX cluster with an interactive map helping operators and DX hunters
to track, visualize, filter and monitor DX station and view the state of the bands.
Developed by Israeli amateur radio development team with support from the Israeli Association of Radio Communication (IARC).


### Key Features

- **Interactive World Map**: Live, real-time map enables to assess the state of the bands with a glace
- **CAT Control Integration**: Direct radio control and intergation locally istalled component
- **Advanced Filtering**: Filter spots by band, mode, continent, callsign, and more
- **Propagation Data**: Real-time propagation information and predictions
- **Mobile-Friendly Interface**: Responsive design for use on various devices
- **Alert System**: Get notified about specific callsigns or conditions

### System Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection
- For CAT control: Windows with OmniRig

---

## Getting Started

### First Launch

When you first open The Holy Cluster, you'll be prompted to configure your basic settings:

1. **Your Callsign**: Enter your amateur radio callsign
2. **Your Locator**: Enter your Maidenhead grid locator (e.g., KM72JC)
3. **Default Map Radius**: Set your preferred viewing radius (1000-20000 km)
4. **Theme**: Choose between light and dark themes
5. **Distance Units**: Select kilometers or miles

> ** [PLACEHOLDER: First Launch Settings Dialog]**
> *Screenshot showing the initial settings configuration dialog*

### Understanding the Interface

The Holy Cluster interface consists of several main components:

- **Top Bar**: Contains settings, filters, and utility buttons
- **Map View**: Interactive world map showing radio spots
- **Spots Table**: Detailed list of all spots with sorting capabilities
- **Left Panel**: Filters and controls (on desktop)
- **Mobile Tabs**: Map and table views (on mobile devices)

> ** [PLACEHOLDER: Main Interface Overview]**
> *Screenshot showing the complete interface with all main components labeled*

---

## Installation

### Web Interface

The HolyCluster web interface runs entirely in your browser and requires no installation.
Simply visit the website and start using it immediately.

### CAT Server (Optional)

For radio control integration, you can install the CAT server software:

#### Windows Installation

1. Download the latest CAT server installer from The Holy Cluster website
2. Run the installer and follow the setup wizard
3. The CAT server will appear in your system tray
4. Configure your radio connection in the settings

> ** [PLACEHOLDER: CAT Server Installation]**
> *Screenshot showing the CAT server installation process and system tray icon*

## User Interface Overview

### Main Components

- **Top Bar**: Settings button, Network status indicator, Spots time limit, UTC clock and Spot submitting button
- **Map Interface**: Interactive Map, Zoom control, night display and propagation data.
- **Spots Table**: Filtered and sorted spots data 
- **Left Panel**: Continent filtering, Band bar, Advanced filters and alerts and auxiliary buttons
- **Right Panel**: Band and mode filters

---

## Map Interface

### Navigation

- **Pan**: Double click anywhere on a map to reposition it to the center
- **Zoom**: Use mouse wheel or zoom controls
- **Center**: Click the center button to return to your location defined in the settings

> ** [PLACEHOLDER: Map Navigation Controls]**
> *Screenshot showing the map with navigation controls and zoom functionality*

### Spot Interaction

- **Hover Spot**: Hover over a stop to hightlight it, show the azimuth line from the center,
  show it in the table, and display additional information in the bottom left corner of the map.
- **Click Spot**: Click any spot to pin it so it stays highlighted, Press Escape to unpin it.
- **CAT Control**: Souble click a spot to tune your radio (if CAT server is running)

> ** [PLACEHOLDER: Spot Interaction Example]**
> *Screenshot showing spot markers, hover information, and spot popup details*

### Map Controls

- **Auto Radius**: Automatically adjust radius based to zoom as much as possible with all spots still visible.
- **Undo CAT**: Return to previous frequency, after changing frequency using the CAT.
- **Night Display**: Click on the night icon to visualize when in the world it is night now.

### Visual Elements

- **Spot Colors**: Different colors for different bands
- **Mode Shape**: The spotted station is displayed on the map with shape that hints the reported mode.
  The modes' shapes are displayed in the left column mode filtering buttons.
- **Equator Line**: Geographic reference line, can be enabled in the settings

> ** [PLACEHOLDER: Map Visual Elements]**
> *Screenshot showing different spot colors, sizes, propagation lines, and equator line*

---

## Spots Table

### Table Features

- **Sorting**: Click column headers to sort ascending/descending
- **Context Menu**: Right-click on flags/callsigns for quick filter creation and additional actions
- **Pinning**: Click a row to pin it, and Escape to unpin it
- **Quick QRZ search** - Clicking on DX or spotter callsign will open their QRZ page
- **Frequency Change**: When CAT control is used, clicking on a frequency will change the radio's frequency.
- **Highlighting**: New spots are highlighted when added

> ** [PLACEHOLDER: Spots Table Interface]**
> *Screenshot showing the spots table with sortable columns and context menu*

---

## Alerts and Filters

The displayed spots can be filtered by:
- Band
- Mode
- Continent
- Time limit
- Advanced filtering
  - Show only/Hide
  - DX/Spotter
  - Prefix/Suffix/Entity/Self spotters

### Callsign Filtering

- **Alert List**: Highlight spots interesting to the operator by specific criteria
- **Show Only**: Display only specific callsigns
- **Hide List**: Hide specific callsigns from view

A spot will be displayed only if it matches all the Show Only and Hide filters.
If a spot matches an alert, it will be shown, regardless of the other filters.
The Show Only filters, Hide filters and alerts can be temporarily turned off with the On/Off switch
at the top right corner of each filter section.

> ** [PLACEHOLDER: Callsign Filter Interface]**
> *Screenshot showing callsign filtering options, alert lists, and search functionality*

---

## Settings and Configuration

### General Settings

#### Personal Information
- **Callsign**: Your amateur radio callsign, used when submitting new spots
- **Locator**: Your Maidenhead grid locator, used when the "Home" button is pressed to recenter the map
- **Default Radius**: Default map viewing radius
- **Distance Units**: Kilometers or miles

> ** [PLACEHOLDER: General Settings Dialog]**
> *Screenshot showing the general settings tab with personal information fields*

#### Display Preferences
- **Theme**: Light or dark theme selection
- **Propagation Display**: Show/hide propagation data
- **Flags**: Show country or entity flags, or the entity names
- **Equator**: Show/hide equator line

### CAT Control Settings

#### Logger Integration

Currently tested with Log4OM, should work with any software that integrates with WSJT-X.

- **Report Callsign**: Send clicked callsign to logging software
- **UDP Port**: Port for WSJT-X UDP packet. The default port is the same as in WSJT-X and Log4OM.

> ** [PLACEHOLDER: CAT Control Settings]**
> *Screenshot showing the CAT control settings tab with radio integration options*

Log4OM should be configured like this:

> ** [PLACEHOLDER: Logging software settings]**
> *Screenshot showing the required Log4OM settings*

### Import/Export

#### Settings Backup

The settings and filters can be exported and imported. 
The filters are splitted to the settings in sidebars (bands, modes and continents).

- **Export Settings**: Save your configuration to a file
- **Import Settings**: Restore from saved file

---

## CAT Control Integration

### What is CAT Control?

CAT (Computer Aided Transceiver) control allows the Holy Cluster to communicate directly with your radio,
enabling automatic frequency tuning and mode changes when you click on spots.

Communication with the transceiver requires access to omnirig which cannot be done only with a website.
This is why locally installed software is required. The installed CAT server acts as a bridge between the website,
Omnirig and other facilities (Like sending clicked spots to loggers like Log4OM).

Currently only windows is supported because the CAT server uses omnirig.
In the future we might release support for linux or mac that will interface rigctld.
Direct integration of hamlib is not planned.

### Setting Up CAT Control

#### Windows (OmniRig)
1. Install OmniRig software
2. Configure OmniRig for your radio. Make sure that other software works correctly with your rig.
3. Install HolyCluster CAT server
4. Start the installed CAT server and wait for several second until the browser is opened.
5. If all is done correctly, 

### Using CAT Control

- **Click to Tune**: Click any spot to change frequency and mode of the tranceiver
- **Undo Function**: Return to previous frequency and mode
- **Frequency Display**: See current radio frequency
- **Rig selection**: Change between rig 1 and rig 2 of omnirig
- **Logging Integration**: Send clicked spots to logging software

> ** [PLACEHOLDER: CAT Control in Action]**
> *Screenshot showing CAT control functionality with radio frequency display and tuning*

---

## Additional Features

### Propagation Data

At the bottom right corner of the map there are 3 columns that display the current state of propagation data.
The data is taken from "Space Weather Predicition Center" (SWPC) of the american "National Oceanic and Atmospheric Administration" (NOAA).

#### Propagation Data
- **Propagation Display**: Visual propagation indicators
- **Propagation Lines**: Show signal paths
- **Data gathering time**: Hovering over each column will show the time this data was gathered, as supplied by SWPC.

> ** [PLACEHOLDER: Propagation Display]**
> *Screenshot showing propagation data, lines, and indicators on the map*

### Mobile Features
- **Responsive Design**: Optimized for mobile devices
- **Touch Controls**: Touch-friendly interface
- **Mobile Tabs**: Easy switching between map and table

> ** [PLACEHOLDER: Mobile Interface]**
> *Screenshot showing the mobile interface with tabs and touch controls*

---

### Getting Help

#### Technical Support
- **User Manual**: This documentation
- **Email Support**: holycluster@iarc.org
- **Bug Reports and Feature Requests**: Report issues and bugs
- **Community Support**: User community help

---

### About the Project

HolyCluster is developed by Israeli amateur radio operators with support from the Israeli Association of Radio Communication (IARC).
The project aims to provide a valuable tool for radio operators worldwide,
To improve the traditional interface of dx clusters make DXing fun and effective.

### Acknowledgments

- **IARC**: Israeli Association of Radio Communication
- **Development Team**: HolyCluster development team
- **Community**: User community and contributors
- **Tutorials**: Special thanks to Stuart (VE9CF) for tutorial videos

---

*This manual is a living document and will be updated as new features are added to HolyCluster.
For the latest information, please visit the HolyCluster website.*
