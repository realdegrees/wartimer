import logger from '../../../lib/logger';
import { VerboseError } from '../../common/errors/verbose.error';
import { GuildMessage, Reaction } from '../../common/reaction';
import { getSampleTriggerCommand } from '../../common/util';
import { AudioInfo } from './add.reaction';
import { download, play } from './audio-utils';



export const audioPlayReaction = Reaction.create<
    GuildMessage,
    AudioInfo>({name: 'play'}, async (context, audio) => {
        if (!context.message.member.voice.channel) {
            throw new VerboseError('You are not in a voicechannel!');
        }
        try {
            const resetName = await context.trigger.bot.changeName(
                audio.command,
                context.message.guild
            );
            const stream = await download(audio);

            await play(
                context.message.member.voice.channel,
                stream,
                {
                    type: audio.source === 'youtube' ? 'opus' : 'unknown',
                    volume: .5,
                    time: audio.time
                }).finally(resetName);
        } catch (e) {
            logger.error(e);
            throw new VerboseError(
                `Unable to play '${audio.command}' from source '${audio.source}'`
            );
        }
    }, {
        pre: async (context) => {
            const command = context.message.content.trim();
            if (command === '') {
                throw new VerboseError('You didn\'t specify the audio you want to play!');
            }
            return context.trigger.db.firestore.doc<AudioInfo>(
                ['guilds', context.message.guild.id, 'audio', command].join('/')
            )
                .then(async (audio) => {
                    if (!audio) {
                        const sample = await getSampleTriggerCommand(
                            context.trigger,
                            context.message.guild);
                        throw new VerboseError(
                            `'${command}' is not a valid command!\nHint: Use ${sample} list`
                        );
                    } else {
                        return audio;
                    }

                });
        }
    });

