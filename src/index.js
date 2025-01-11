import { vec3, mat3, mat4, quat } from 'gl-matrix'; // Ensure mat4 is imported
import { BLOCK } from './scripts/blocks.js'; // Ensure BLOCK is imported
import './scripts/helpers.js';
import './scripts/world.js';
import './scripts/render.js';
import './scripts/physics.js';
import './scripts/player.js';
import { Renderer } from './scripts/render.js';
import { Player } from './scripts/player.js';
import { World } from './scripts/world.js';
import { Vector } from './scripts/helpers.js'; // Correct import for Vector

window.global = window;

let world;
let render;
let intervalId; // Define intervalId at the top level

const page = {
	nickname: document.getElementById('nickname'),
	joinInfo: document.getElementById('joininfo'),
	joinInfoText: document.getElementById('joininfo_text'),
	renderSurface: document.getElementById('renderSurface'),
	materialSelector: document.getElementById('materialSelector'),
	chatbox: document.getElementById('chatbox'),
	chatboxEntry: document.getElementById('chatbox_entry'),
	chatboxText: document.getElementById('chatbox_text'),
	loadingScreen: document.getElementById('loadingScreen') // Add loading screen element
};

for (const [key, value] of Object.entries(page)) {
	if (value === null) {
		console.error(`Element with id '${key}' not found.`);
	}
}

if (page.nickname) {
	page.nickname.style.color = 'white';
	page.nickname.style.backgroundColor = 'black';
}

// Ensure nickname input is correctly handled
const nicknameInput = document.getElementById('nickname_input');
if (nicknameInput) {
    nicknameInput.onkeypress = (e) => {
        if (!nicknameInput.value) return;
        const nickname = nicknameInput.value.trim();
        
        if (e.keyCode !== 13 || nickname.length === 0) return;
        
        console.log("Nickname entered:", nickname);
        nicknameInput.blur();
        joinGame(nickname);
    };
}

window.onChatEnter = (chatInput, keyEvent) => {
	const msg = chatInput.value.trim();

	if (keyEvent.keyCode !== 13) return;
	chatInput.blur();
	page.chatbox.style.height = null;
	if (msg.length === 0) return;

	chatInput.value = "";
};

// Ensure cleanup handles animation frame
const cleanup = () => {
    if (intervalId) {
        cancelAnimationFrame(intervalId);
    }
    if (render) {
        render.cleanup();
    }
    if (world) {
        // Add world cleanup if needed
    }
};

// Add event listener for page unload
window.addEventListener('unload', cleanup);

const joinGame = async (nickname) => {
    try {
        console.log("Joining game with nickname:", nickname);
        page.loadingScreen.style.display = 'block'; // Show loading screen

        // Generate world
        console.log("Generating world...");
        world = await World.generateWorld(100, 100, 50); // Use outer world variable
        console.log("World generated successfully");

        // Initialize renderer with proper sequence
        console.log("Initializing renderer...");
        render = new Renderer('renderSurface');
        render.setPerspective(Math.PI/4, render.canvas.width/render.canvas.height, 0.1, 1000);
        
        // Initialize all chunks before starting
        render.setWorld(world, 16);
        
        // Force build ALL chunks initially
        console.log("Building ALL chunks...");
        let chunksRemaining = true;
        while (chunksRemaining) {
            chunksRemaining = false;
            for (const chunk of render.chunks) {
                if (chunk.dirty) {
                    chunksRemaining = true;
                    break;
                }
            }
            render.buildChunks(50); // Build more chunks per batch
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        console.log("Initial chunk build complete");
        
        // Initialize player after world and chunks are ready
        console.log("Initializing player...");
        const player = new Player();
        player.setWorld(world);
        player.setClient(null);
        player.setInputCanvas('renderSurface');
        player.setMaterialSelector('materialSelector');
        
        // Set initial camera position
        render.setCamera(player.getEyePos().toArray(), player.angles);
        
        // Ensure UI elements are properly configured
        page.loadingScreen.style.display = 'none';
        page.nickname.style.display = 'none';
        page.joinInfo.style.display = 'none';
        page.renderSurface.style.visibility = "visible";
        page.materialSelector.style.display = "block";
        page.chatbox.style.visibility = "visible";
        page.chatboxEntry.style.visibility = "visible";

        // Build initial chunks around spawn
        console.log("Building initial chunks...");
        const spawnPos = world.spawnPoint;
        render.updateChunksAroundPlayer(spawnPos);
        
        // Modified game loop
        const gameLoop = () => {
            try {
                player.update();
                
                // Update camera and chunks
                const eyePos = player.getEyePos();
                render.setCamera(eyePos.toArray(), player.angles);
                render.updateChunksAroundPlayer(eyePos);
                
                // Render frame
                render.draw();
                
            } catch (error) {
                console.error("Error in game loop:", error);
            }
            intervalId = requestAnimationFrame(gameLoop);
        };

        // Add window resize handler
        window.addEventListener('resize', () => {
            if (render) {
                render.updateViewport();
            }
        });
        
        intervalId = requestAnimationFrame(gameLoop);

    } catch (error) {
        console.error("Failed to join game:", error);
        page.joinInfoText.textContent = "Failed to join game: " + error.message;
        page.joinInfo.style.display = 'block';
    }
};
