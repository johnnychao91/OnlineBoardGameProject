import { GAME_CATEGORY_LABELS, gameCatalog, type GameID } from '../games/catalog';
import './game-metadata.css';

export function GameMetadata({ gameID }: { gameID: GameID }) {
  const game = gameCatalog[gameID];
  return <div className="game-metadata">
    <span className="game-player-count">{game.minPlayers}～{game.maxPlayers} 人</span>
    <ul className="game-tags" aria-label="遊戲標籤">
      {game.categories.map(category => <li className="game-tag" data-category={category} key={category}>{GAME_CATEGORY_LABELS[category]}</li>)}
      {game.tags.map(tag => <li className="game-tag" key={tag}>{tag}</li>)}
    </ul>
  </div>;
}
