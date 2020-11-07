import { Message } from 'discord.js';
import { TriggerMatch } from './types';
import { TriggerOptions } from './types/trigger-options';
import { DirectMessage, GuildMessage, Reaction } from './reaction';
import Bot from '../bot';
import Firebase from '../../lib/firebase';
import { escapeRegex, fetchPrefix, getSampleTriggerCommand } from './util';
import { NoMatchError } from './errors/no-match.error';
import { VerboseError } from './errors/verbose.error';

// TODO: Add trigger.on, trigger.emit so one reaction can stop another one for example
export class Trigger {
    // Set via reflection, do not use in constructor
    public readonly bot!: Omit<Bot, 'use'>;
    // Set via reflection, do not use in constructor
    public readonly db!: Firebase;

    private enabled = true;

    /**
     * Creates a new Trigger that issues the callback when a message 
     * is sent that passes the conditions provided in the options param
     * @param reaction The reaction object to be executed after a successful permission check
     * @param options If not provided, the callback will be triggered on every message
     */
    public constructor(
        public readonly reactions: ReactionMap,
        public readonly options?: TriggerOptions,
    ) {
        // ! This reflection must be the first expression on instantiation

        Object.values(reactions)
            .forEach((reactions) => {
                if (reactions) {
                    [
                        ...reactions.direct ?? [],
                        ...reactions.guild ?? [],
                        ...reactions.all ?? [],
                    ].forEach((reaction) => Reflect.set(reaction, 'trigger', this));
                }
            });
    }

    public async react(message: Message): Promise<unknown[]> {
        const subTrigger = message.content.split(' ')[0] || 'default';

        const [filteredDefaultReactions, filteredSubReactions] = [
            this.filterReactions(this.reactions.default, {
                guild: !!message.guild
            }),
            this.filterReactions(this.reactions.sub, {
                guild: !!message.guild
            })
        ];
        if (subTrigger === 'default') {
            if (filteredDefaultReactions) {
                return Promise.all([
                    ...filteredDefaultReactions.direct.map((r) => r.run(message as DirectMessage)),
                    ...filteredDefaultReactions.guild.map((r) => r.run(message as GuildMessage)),
                    ...filteredDefaultReactions.all.map((r) => r.run(message as Message))
                ]);
            } else if (filteredSubReactions && message.guild) {
                const guild = message.guild;
                const commands = await Promise.all(
                    [
                        ...filteredSubReactions.direct,
                        ...filteredSubReactions.guild,
                        ...filteredSubReactions.all
                    ].map(async (reaction) =>
                        await getSampleTriggerCommand(
                            this,
                            guild, {
                            subTrigger: reaction.name
                        })
                    ));

                throw new VerboseError('This is not a standalone command try one of these:\n' +
                    commands.join(' / '));
            } else {
                throw new VerboseError('You cannot use this command in direct messages');
            }
        } else {
            this.removeFromMessage(message, subTrigger);

            if (!filteredSubReactions) {
                if (subTrigger !== 'default') {
                    throw new VerboseError(`You cannot run this command with "${subTrigger}"`);
                } else {
                    throw new NoMatchError(
                        `No reactions defined for <${this.options?.commandOptions?.command ?? ''}>`
                    );
                }
            }

            return Promise.all([
                ...filteredSubReactions.direct
                    .filter((r) => r.name === subTrigger)
                    .map((r) => r.run(message as DirectMessage)),
                ...filteredSubReactions.guild
                    .filter((r) => r.name === subTrigger)
                    .map((r) => r.run(message as GuildMessage)),
                ...filteredSubReactions.all
                    .filter((r) => r.name === subTrigger)
                    .map((r) => r.run(message as Message))
            ]);
        }
    }

    private filterReactions(
        item: ReactionMapItem | undefined,
        options?: {
            guild?: boolean;
            nameFilter?: string;
        }): Required<ReactionMapItem> | undefined {
        return item ? {
            direct: !options?.guild ? item.direct ?? [] : [],
            guild: options?.guild ? item.guild ?? [] : [],
            all: item.all ?? [],
        } : undefined;
    }

    public patchOptions(options: TriggerOptions): void {
        Object.assign(this.options, options);
    }

    public enable(): boolean {
        return this.enabled = true;
    }
    public disable(): boolean {
        return this.enabled = false;
    }
    // TODO: make use of this with the configure command to enable/disable specific commands
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Checks if this Trigger instance should issue its' 
     * callback based on the options provided in constructor
     * @param message 
     */
    public check(message: Message): Promise<Message> {
        return this.enabled ? this.checkCommand(message)
            .then((message) => this.checkChannel(message))
            .then((message) => this.checkPermission(message))
            .then((message) => this.checkRoles(message))
            .then((message) => this.checkCustomCondition(message)) :
            Promise.reject(new VerboseError('This command is disabled.'));
    }

    private async checkCommand(message: Message): Promise<Message> {
        if (!this.options?.commandOptions) {
            return message;
        }
        const content = message.content;
        const prefix = !this.options.commandOptions.ignorePrefix ?
            await fetchPrefix(message.guild, this.db) : '';
        const match = this.options.commandOptions.match;

        const command = this.options.commandOptions.command
            .map((command) => prefix + command)
            .find((command) => this.matches(content, command, match));
        if (command) {
            this.removeFromMessage(message, command);
            return message;
        } else {
            throw new NoMatchError();
        }
    }
    private matches(content: string, command: string, match: TriggerMatch): boolean {
        const result = ((): boolean => {
            switch (match) {
                case TriggerMatch.CONTAINS:
                    return content.includes(command);
                case TriggerMatch.EQUALS:
                    return !!content.match(new RegExp(`^${escapeRegex(command)}$`));
                case TriggerMatch.STARTS_WITH:
                    return !!content.match(new RegExp(`^${escapeRegex(command)} .*`)) ||
                        !!content.match(new RegExp(`^${escapeRegex(command)}$`));
            }
        })();
        return result;
    }
    /**
     * Removes the specified text from the message and cleans whitespaces
     */
    private removeFromMessage(message: Message, text: string): void {
        message.content = message.content.split(text).join('').replace(/\s{2,}/g, ' ').trim();
    }
    private async checkCustomCondition(message: Message): Promise<Message> {
        return Promise.resolve()
            .then(() => this.options?.conditionCheck?.(message, this))
            .then(() => message);
    }
    private checkChannel(message: Message): Promise<Message> {
        const channelId = message.channel.id;
        return new Promise((resolve, reject) => {
            if (this.options?.channels) {
                const isIncluded = this.options.channels.include?.length ?
                    this.options.channels.include.includes(channelId) :
                    true;
                const isExcluded = this.options.channels.exclude?.includes(channelId);

                isIncluded && !isExcluded ?
                    resolve(message) :
                    reject(new VerboseError('This command does not work in this channel'));
            } else {
                resolve(message);
            }
        });
    }
    private checkRoles(message: Message): Promise<Message> {
        const member = message.member;
        return new Promise((resolve, reject) => {
            if (!this.options?.roles) {
                resolve(message);
                return;
            }
            if (member) {
                const isIncluded = this.options.roles.include?.length ?
                    this.options.roles.include.some(
                        (role) => member.roles.resolve(role)) :
                    true;
                const isExcluded = this.options.roles.exclude?.some(
                    (role) => member.roles.resolve(role));

                isIncluded && !isExcluded ?
                    resolve(message) :
                    reject(new VerboseError('You are missing a required role for this command!'));
            } else {
                reject(new VerboseError('Unable to retrieve message author! Can\'t check roles'));
            }
        });
    }
    /**
     * Checks if the provided member has the right to issue this command
     * Dictated by the commandOptions for this trigger
     * @param member 
     */
    private checkPermission(message: Message): Promise<Message> {
        const member = message.member;
        return new Promise((resolve, reject) => {
            if (!this.options?.requiredPermissions) {
                resolve(message);
                return;
            }
            if (member) {
                if (this.options.requiredPermissions.every(
                    (permission) => member.hasPermission(permission))
                ) {
                    resolve(message);
                } else {
                    reject(new VerboseError('You do not have permission to issue this command!'));
                }
            } else {
                reject('Unable to retrieve message author! Can\'t check permissions');
            }
        });
    }
}
type ReactionMap = {
    readonly default: ReactionMapItem;
    readonly sub?: ReactionMapItem;
};
type ReactionMapItem = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly guild?: Reaction<GuildMessage, any>[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly direct?: Reaction<DirectMessage, any>[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly all?: Reaction<Message, any>[];
};
export type TriggerCondition = (
    message: Message,
    context: Trigger
) => void;
export type AsyncTriggerCondition = (
    message: Message,
    context: Trigger
) => Promise<void>;