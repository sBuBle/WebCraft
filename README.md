# WebCraft

> A browser-based Minecraft Classic clone built with WebGL

[![GitHub issues](https://img.shields.io/github/issues/Overv/WebCraft.svg)](https://github.com/Overv/WebCraft/issues)
[![GitHub forks](https://img.shields.io/github/forks/Overv/WebCraft.svg)](https://github.com/Overv/WebCraft/network)
[![GitHub stars](https://img.shields.io/github/stars/Overv/WebCraft.svg)](https://github.com/Overv/WebCraft/stargazers)
[![GitHub license](https://img.shields.io/github/license/Overv/WebCraft.svg)](https://github.com/Overv/WebCraft/blob/master/LICENSE)

📦 **Lightweight**: No heavy game engines, just pure WebGL
🎮 **Playable**: Basic world viewing and navigation
🚧 **In Development**: Core features still under construction

![Singleplayer structure](http://i.imgur.com/2qBGy.png)

## ⚠️ Development Status

Currently Working:

- Basic world generation
- WebGL-based rendering
- Simple camera controls
- World loading system

Under Development:

- Block manipulation (breaking/placing)
- Physics system integration
- Multiplayer functionality
- Player interactions

Not Implemented:

- Real-time block manipulation
- Inventory system
- Block types beyond basic terrain
- Saving/loading worlds

## 🚀 Quick Start

1. **Install Dependencies**

   ```bash
   npm install
   ```
2. **Start the Game**

   ```bash
   npm start
   ```
3. **Open in Browser**

   ```
   http://localhost:3000
   ```

## ✨ Features

- WebGL-based world rendering
- Chunk-based terrain system
- Basic navigation controls
- World generation
- Development framework for extending functionality

## 🎮 Controls (Limited Functionality)

- **WASD** - Move camera
- **Mouse** - Look around
- **Space** - Move up
- **Shift** - Sprint

## 🔧 Development

```bash
# Start dev server
npm run dev

# Build for production
npm run build
```

## 🏗 Architecture

Our game is built with these core systems:

- **World** - Manages the block-based environment
- **Render** - Handles WebGL graphics
- **Physics** - Controls game physics
- **Player** - Manages player actions
- **Network** - Handles multiplayer

## 💻 Requirements

- Any modern browser with WebGL support
- Node.js 14 or higher
- 2GB RAM minimum
- Graphics card with WebGL support

## 🤝 Contributing

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## ❓ Troubleshooting

**Black Screen?**

- Check if WebGL is enabled in your browser
- Update your graphics drivers
- Try a different browser

**Low FPS?**

- Reduce render distance
- Close other browser tabs
- Check GPU acceleration settings

**Controls Not Working?**

- Click the game window to focus
- Check if keyboard input is blocked
- Restart the game

## 📝 License

MIT License - feel free to use for your own projects!

---

> **Note:** This project is no longer actively maintained, but still works great for learning and experimentation!
