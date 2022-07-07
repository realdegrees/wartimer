import { getVoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import { APIRole } from 'discord-api-types/v9';
import {
    ButtonInteraction, Guild,
    InteractionDeferUpdateOptions,
    Message, MessageActionRow, MessageButton, Role
} from 'discord.js';
import logger from '../../lib/logger';
import audioplayer from '../audioplayer';
import intervalText from './intervalText';

const buttonIds = {
    toggle: 'toggle',
    voice: 'voice'
};
const resetDurationSeconds = 7;
const timeoutDurationSeconds = 3;

export class Widget {
    private toggleState = false;
    private voiceState = false;
    private isUpdating = false;
    private deferButtonQueue: ((
        options?: InteractionDeferUpdateOptions | undefined
    ) => Promise<void>)[] = [];

    /**
     * @param interaction The interaction that created this widget
     * @param message The message that this widget should live in
     * @param guild The guild where the interaction was executed
     * @param managerRole The role that was specified in the command
     */

    public constructor(
        private message: Message,
        private guild: Guild,
        private managerRole: Role | APIRole | null | undefined,
        onReady: (widget: Widget) => void,
        private onDestroy?: (widget: Widget) => void
    ) {
        this.init(onReady);
    }
    private async init(onReady: (widget: Widget) => void): Promise<void> {
        this.managerRole = this.managerRole ?? this.parseManagerRole();
        await new Promise((res) => setTimeout(res, 500));
        await this.message.edit({
            components: [this.getButtons()],
            embeds: [this.message.embeds[0].setFooter({
                text: 'ID: ' + this.message.id + (this.managerRole ? '\nManager Role: @' + this.managerRole.name : '')
            })]
        }).then((message) => {
            this.message = message;
            logger.log('Widget ' + this.getId() + ' created.\nRole: ' +
                (this.managerRole?.name ?? '-') + '\nChannel: ' + message.channel.id);
            onReady(this);
        });
    }
    private parseManagerRole(): Role | undefined {
        const roleName = this.message.embeds[0].footer?.text.split('@')[1];
        logger.log(roleName ?? 'No rolename found');
        if (roleName) {
            return this.guild.roles.cache.find((role) => role.name === roleName);
        }
    }
    private getButtons(disableToggle = false, disableVoice = false): MessageActionRow {
        return new MessageActionRow()
            .addComponents(new MessageButton()
                .setCustomId(buttonIds.toggle + '-' + this.message.id)
                .setLabel(this.toggleState ? 'ℹ️' : 'ℹ️')
                .setStyle(this.toggleState ? 'DANGER' : 'SUCCESS')
                .setDisabled(disableToggle))
            .addComponents(new MessageButton()
                .setCustomId(buttonIds.voice + '-' + this.message.id)
                .setLabel(this.voiceState ? '🔇' : '🔊')
                .setStyle(this.voiceState ? 'DANGER' : 'SUCCESS')
                .setDisabled(disableVoice));
    }
    public getId(): string {
        return this.message.id;
    }
    public async update(title?: string, description?: string): Promise<void> {
        if (this.isUpdating) {
            this.deferButtonQueue.forEach((def) => def());
            this.deferButtonQueue = [];
            return;
        }
        this.isUpdating = true;
        const beforeEditTimestamp = Date.now();
        await this.message.edit({
            components: [this.getButtons()],
            embeds: [this.message.embeds[0]
                .setTitle(title ?? this.message.embeds[0].title ?? 'Respawn Timer')
                .setDescription(description ?? this.message.embeds[0].description ?? '')]
        }).then((message) => {
            this.message = message;
            this.deferButtonQueue.forEach((def) => def());
            this.deferButtonQueue = [];

            if (Date.now() - beforeEditTimestamp > timeoutDurationSeconds * 1000) {
                this.recreateMessage();
            } else {
                this.isUpdating = false;
            }
        }).catch(async () => {
            intervalText.unsubscribe(this.message.id, true);
            logger.info('Unable to edit message ' + this.message.id +
                ' unsubscribing updates and attempting todelete message.');
            try {
                await this.message.delete();
                logger.info('Deleted message');
            } catch {
                logger.info('Unable to delete message' + this.message.id);
            }
            if(this.voiceState) {
                this.disconnect();
            }
            this.onDestroy?.(this);
        });
    }
    public resetEmbed(): void {
        this.toggleState = false;
        this.isUpdating = false;
        this.update('Respawn Timer', this.voiceState ? 'Audio On' : '');
    }
    private recreateMessage(): void {
        logger.info('Response took too long, taking timeout');
        this.message.delete().finally(() => {
            this.message.channel.send({
                components: [this.getButtons(true, true)],
                embeds: [this.message.embeds[0]
                    .setTitle('Slow Discord API Response')
                    .setDescription(
                        `Resetting.. (${resetDurationSeconds}s)
                        This only affects the widget.\nAudio announcements still work.`
                    )]
            }).then((message) => {
                intervalText.updateSubscription(this.message.id, message.id);
                this.message = message;
                this.message.edit({
                    components: [this.getButtons(true)],
                });
                setTimeout(() => {
                    logger.info('Resuming updates after timeout');
                    this.isUpdating = false;
                    if (!this.toggleState) {
                        this.resetEmbed();
                    }
                }, resetDurationSeconds * 1000);
            });
        }).catch();
    }
    public async toggle(interaction: ButtonInteraction): Promise<void> {
        if (!await this.checkPermission(interaction)) {
            await interaction.reply({ ephemeral: true, content: 'You do not have the necessary permissions Qseng.' });
            return;
        }
        this.deferButtonQueue.forEach((def) => def());
        this.deferButtonQueue = [];

        this.toggleState = !this.toggleState;
        this.deferButtonQueue.push(interaction.deferUpdate.bind(interaction));
        if (this.toggleState) {
            this.enable();
        } else {
            this.disable();
        }
    }
    public async toggleVoice(interaction: ButtonInteraction): Promise<void> {
        if (!await this.checkPermission(interaction)) {
            await interaction.reply({ ephemeral: true, content: 'You do not have the necessary permissions Qseng.' });
            return;
        }
        this.deferButtonQueue.forEach((def) => def());
        this.deferButtonQueue = [];

        this.voiceState = !this.voiceState;
        if (this.voiceState) {
            try {
                await this.connect(interaction);
                if (!this.toggleState) {
                    await interaction.deferUpdate();
                    this.update('Respawn Timer', 'Audio On');
                } else {
                    this.deferButtonQueue.push(interaction.deferUpdate.bind(interaction));
                }
            } catch {
                this.voiceState = false;
            }

        } else {
            this.disconnect();
            if (!this.toggleState) {
                await interaction.deferUpdate();
                this.update('Respawn Timer', '');
            } else {
                this.deferButtonQueue.push(interaction.deferUpdate.bind(interaction));
            }
        }
    }
    private async checkPermission(interaction: ButtonInteraction): Promise<boolean> {
        return !this.managerRole || (await this.guild.members
            .fetch(interaction.user)).roles.cache.some((r) => r.name === this.managerRole?.name);
    }
    private enable(): void {
        intervalText.subscribe(
            this.message.id,
            this.guild.id,
            this.update.bind(this),
            this.resetEmbed.bind(this)
        );
    }
    private disable(): void {
        intervalText.unsubscribe(this.message.id);
    }
    private async connect(interaction: ButtonInteraction): Promise<void> {
        const channel = (await interaction.guild?.members.fetch(interaction.user))?.voice.channel;
        if (!channel) {
            await interaction.reply({ ephemeral: true, content: 'You are not in a voice channel!' });
            throw new Error('Not in a voice channel');
        }
        const connection = joinVoiceChannel({
            guildId: channel.guild.id,
            channelId: channel.id,
            adapterCreator: channel.guild.voiceAdapterCreator
        });
        audioplayer.subscribe(connection);
    }
    private disconnect(): void {
        getVoiceConnection(this.guild.id)?.destroy();
    }
}