const Discord = require('discord.js');
const config = require('./config.json');
const opus = require('node-opus');
const ytdl = require('ytdl-core');
const opusscript = require('opusscript');
const Syta = require("simple-youtube-api");

const bot = new Discord.Client({
    disableEveryone: true
});

const syta = new Syta(config.googletoken);

const queue = new Map();

bot.on('warn', console.warn);

bot.on('error', console.error);

bot.on('ready', () => console.log('Ready'));

bot.on('disconnect', () => console.log('I just disconnected, making sure you know, I will reconnect now...'));

bot.on('reconnecting', () => console.log('I am reconnecting now!'));

bot.on('message', async msg => { // eslint-disable-line
    if (msg.author.bot) return;
    if (!msg.content.startsWith(config.prefix)) return;

    const args = msg.content.split(' ');
    const searchString = args.slice(1).join(' ');
    const url = args[1] ? args[1].replace(/<(.+)>/g, '$1') : '';
    const serverQueue = queue.get(msg.guild.id);

    let command = msg.content.toLowerCase().split(' ')[0];
    command = command.slice((config.prefix).length)

    switch (command) {
        case 'clear':
            msg.channel.bulkDelete(args[1]).then(() =>{
                msg.channel.send('Cleared ${args[0]} messages').then(msg => msg.delete(3000))
            });
        break;
        case 'play':
            const voiceChannel = msg.member.voiceChannel;
            if (!voiceChannel) return msg.channel.send('I\'m sorry but you need to be in a voice channel to play music!');

            if (url.match(/^https?:\/\/(www.youtube.com|youtube.com)\/playlist(.*)$/)) {
                const playlist = await syta.getPlaylist(url);
                const videos = await playlist.getVideos();
                for (const video of Object.values(videos)) {
                    const video2 = await syta.getVideoByID(video.id); // eslint-disable-line no-await-in-loop
                    await handleVideo(video2, msg, voiceChannel, true); // eslint-disable-line no-await-in-loop
                }
                return msg.channel.send(`Playlist: **${playlist.title}** has been added to the queue!`);
            } else {
                try {
                    var video = await syta.getVideo(url);
                } catch (error) {
                    try {
                        var videos = await syta.searchVideos(searchString, 5);
                        let index = 0;
                        msg.channel.send(`
__**Song selection:**__
${videos.map(video2 => `**${++index} -** ${video2.title}`).join('\n')}
Please provide a value to select one of the search results ranging from 1-5.
					`);
                        // eslint-disable-next-line max-depth
                        try {
                            var response = await msg.channel.awaitMessages(msg2 => msg2.content > 0 && msg2.content < 6, {
                                maxMatches: 1,
                                time: 20000,
                                errors: ['time']
                            });
                        } catch (err) {
                            console.error(err);
                            return msg.channel.send("You didn't pick anything dummy.");
                        }
                        const videoIndex = parseInt(response.first().content);
                        var video = await syta.getVideoByID(videos[videoIndex - 1].id);
                    } catch (err) {
                        console.error(err);
                        return msg.channel.send("I don't know what the fuck you are looking for.");
                    }
                }
                return handleVideo(video, msg, voiceChannel);
            }
            case 'skip':
                if (!msg.member.voiceChannel) return msg.channel.send('You are not in a voice channel!');
                if (!serverQueue) return msg.channel.send('Nothing to skip hoss');
                serverQueue.connection.dispatcher.end('I skipped it Jesus!');
                break;
            case 'stop':
                if (!msg.member.voiceChannel) return msg.channel.send('You are not in a voice channel!');
                if (!serverQueue) return msg.channel.send('Nothing to stop stupid.');
                serverQueue.songs = [];
                serverQueue.connection.dispatcher.end('I haulted that shit!');
                break;
            case 'volume':
                if (!msg.member.voiceChannel) return msg.channel.send('You are not in a voice channel!');
                if (!serverQueue) return msg.channel.send('Turn down for what?');
                if (!args[1]) return msg.channel.send(`The current volume is: **${serverQueue.volume}**`);
                serverQueue.volume = args[1];
                serverQueue.connection.dispatcher.setVolumeLogarithmic(args[1] / 5);
                return msg.channel.send(`I set the volume to: **${args[1]}**`);
            case 'np':
                if (!serverQueue) return msg.channel.send('Nothings play yet dude.');
                return msg.channel.send(`🎶 Now playing: **${serverQueue.songs[0].title}**`);
            case 'queue':
                if (!serverQueue) return msg.channel.send('Nothing to play my man.');
                return msg.channel.send(`__**Song queue:**__${serverQueue.songs.map(song => `**-** ${song.title}`).join('\n')} **Now playing:** ${serverQueue.songs[0].title}`);
            case 'pause':
                if (serverQueue && serverQueue.playing) {
                    serverQueue.playing = false;
                    serverQueue.connection.dispatcher.pause();
                    return msg.channel.send(' Paused it for you, massa!');
                }
                return msg.channel.send('nothing playing.');
            case 'resume':
                if (serverQueue && !serverQueue.playing) {
                    serverQueue.playing = true;
                    serverQueue.connection.dispatcher.resume();
                    return msg.channel.send('Resumed the music for you, massa!');
                }
                return msg.channel.send('nothing playing.');

            default:
                return msg.channel.send('Idk what you want.');
    }
});
async function handleVideo(video, msg, voiceChannel, playlist = false) {
    const serverQueue = queue.get(msg.guild.id);
    console.log(video);
    const song = {
        id: video.id,
        title: video.title,
        url: `https://www.youtube.com/watch?v=${video.id}`
    };
    if (!serverQueue) {
        const queueConstruct = {
            textChannel: msg.channel,
            voiceChannel: voiceChannel,
            connection: null,
            songs: [],
            volume: 5,
            playing: true
        };
        queue.set(msg.guild.id, queueConstruct);

        queueConstruct.songs.push(song);

        try {
            var connection = await voiceChannel.join();
            queueConstruct.connection = connection;
            play(msg.guild, queueConstruct.songs[0]);
        } catch (error) {
            console.error(`I could not join the voice channel: ${error}`);
            queue.delete(msg.guild.id);
            return msg.channel.send(`I could not join the voice channel: ${error}`);
        }
    } else {
        serverQueue.songs.push(song);
        console.log(serverQueue.songs);
        if (playlist) return;
        else {
            return msg.channel.send(`**${song.title}** has been added to the queue!`);
        }
    }
}

function play(guild, song) {
    const serverQueue = queue.get(guild.id);

    if (!song) {
        serverQueue.voiceChannel.leave();
        queue.delete(guild.id);
        return;
    }
    console.log(serverQueue.songs);

    const dispatcher = serverQueue.connection.playStream(ytdl(song.url))
        .on('end', reason => {
            if (reason === 'Stream is not generating quickly enough.') {
                console.log('Song ended.');
            } else {
                console.log(reason);
                serverQueue.songs.shift();
                play(guild, serverQueue.songs[0]);
            }
        })
        .on('error', error => console.error(error));
    dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);

    serverQueue.textChannel.send(`Start playing: **${song.title}**`);

}

bot.login(config.token);