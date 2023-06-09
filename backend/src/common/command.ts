import { SlashCommandBuilder } from '@discordjs/builders';
import { RESTPostAPIApplicationCommandsJSONBody } from 'discord-api-types/v9';
import { CacheType, Client, CommandInteraction, Interaction } from 'discord.js';
import Bot from '../bot';

export class Command {
    public constructor(
        public name: string, 
        protected description: string,
        protected client: Client,
        protected subCommand?: Command){
    }
    public build(): RESTPostAPIApplicationCommandsJSONBody {
        throw new Error('Not implemented');
    }
    public execute(interaction: CommandInteraction<CacheType>): Promise<void> {
        throw new Error('Not implemented');
    }
}