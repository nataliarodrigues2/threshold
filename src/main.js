import { Game } from './core/Game.js';

const game = new Game(document.getElementById('app'));
// expose for debugging in the dev console
if (typeof window !== 'undefined') window.game = game;
game.init();
