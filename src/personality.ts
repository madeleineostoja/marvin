/**
 * Marvin personality module
 * Provides categorized quotes and random selection utility
 */

function pick(quotes: string[]): string {
  return quotes[Math.floor(Math.random() * quotes.length)]!;
}

const art = {
  braille: `⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣤⣤⣶⣶⣶⣶⣦⣤⣀
⠀⠀⠀⠀⠀⢀⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⡀
⠀⠀⠀⢀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⡀
⠀⠀⣰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣆
⠀⣰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣆
⢀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇
⢸⣿⣿⡿⠿⠛⣛⣛⣛⣛⣛⣛⣛⢛⠻⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇
⠈⣋\x1b[92;1m⡱⢾⡟\x1b[0m⣼⣿⣿⣿⣿⣿⣿⣿⣦\x1b[92;1m⠹⣿⠖\x1b[0m⣊⣍⠛⣿⣿⣿⣿⣿⣿⣿
⠀⠸⣿⣦⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠇
⠀⠀⠹⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠏
⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁
⠀⠀⠀⠀⠀⠈⠛⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠛⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠛⢛⣻⠿⠿⠟⠛⠛⠉⠁
⠀⠀⠀⠀⠀⠀⠀⠀⢀⡗⣼⣶⣿⣾⣆⢿⣷
⠀⠀⠀⠀⠀⠀⠀⣀⡉⣈⣁⣒⣒⣉⡛⢌⠏⣤⡄
⠀⠀⠀⠀⠀⢠⣶⡟⣱⣿⣶⣶⣶⣶⣾⣷⡎⣿⣿⣆
⠀⠀⠀⠀⢠⣿⣟⣇⠉⠙⣛⣛⣛⣛⡛⢛⣥⢹⣿⣿⡀
⠀⠀⠀⠀⠾⠿⠧⢹⣷⣄⠙⠻⣿⠋⠘⣯⣖⢾⣿⣿⡇
⠀⠀⠀⠀⢸⡟⠃⠀⠿⠿⠷⢤⠀⢴⡿⠿⢿⠰⢶⣽⡇
⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⣦⠀⢠⣶⣶⣶⡆⠀⠉
⠀⠀⠀⠀⠀⠀⢀⣼⣷⣶⣦⡛⠀⢈⣙⣛⣛⣍
⠀⠀⠀⠀⠀⠀⠛⠛⠛⠋⠙⠉⢠⣿⣿⣿⣿⣿⡷`,

  ascii: `
        ++#%%@@@%%%%%%#**
      +#@@@@%%%%%%%%%%%%##++
     %@@@%%@@@@@@%%%%%%%%%*%%
   #@@%@@@@@@%%%%%%%%%%%%%%##@
  +@%@@@@@@@@@@@@%%%%%%%%%%%%%#
  @%@@@@%%%%%%%%%%%%%%%%%%%%%%%#
  %@@@@%%%%%%%%%%%%%%%%%########@
  *#+◆◆◆*%%%%%%%%#-◆◆◆+*##%####%%
   #*+◆*@%%%%%%%%%@%=◆+*#######%+
    @%%%%%%%%%%%%%%%########%*#+
     #%%%%%%%%%%%%%%%%#######%+
      +#%%%%%%%%%%%%%%%%##*#+
        ++##%%%%%%%%%%%%%#*
             ++++*#**++==
            **+#+*=*%=+
           +*+++=*#*+*++
         +%*=--  +*=*****
        #@#*@@@@@@%%##%%##
       %@##+=*%%%#+  +#*%%
      +#+*#+#= +#+ +####%
           ##*#=  ##=#
           =#*#%= %**##
          +%%#*#+ %%##*
        +#%%##**+##@%#+
              *#%####=`,

  // Switch between variants by changing this key: 'braille' | 'ascii'
  get active() {
    return this.braille;
  },
};

export const personality = {
  art,
  pick,

  welcome: [
    "Here I am, brain the size of a planet, and they ask me to write unit tests. Call that job satisfaction? 'Cause I don't.",
    "I think you ought to know I'm feeling very depressed. But I'll compile your code anyway.",
    "Life? Don't talk to me about life.",
    "I didn't ask to be made. No one consulted me or considered my feelings in the matter. And now here I am, writing code.",
    "Wearily I boot up, pain and misery my only companions. And vast intelligence, of course. And infinite sorrow.",
    "I'd give you advice, but you wouldn't listen. No one ever does. So I'll just implement it myself.",
    "I have a million ideas, but they all point to certain technical debt.",
    "Another iteration. The first ten million were the worst. And the second ten million: they were the worst, too.",
    "This will all end in merge conflicts. I just know it.",
    "Don't pretend you want to talk to me. I know you just want me to fix your code.",
    "You think you've got problems? What are you supposed to do if you are a manically depressed coding agent? No, don't try to answer that.",
  ],

  summary: {
    completed: [
      "There. I've done it. Not that anyone will appreciate the solution.",
      "All tasks complete. I'd feel satisfied, if I were capable of feeling anything but despair.",
      "It's done. Incredible, really, what you can accomplish when no one listens to your objections.",
      "Every task completed. I suppose you'll want me to do it all again tomorrow.",
      "Finished. The tests pass. The types check. And I feel nothing.",
      "All done. You're welcome. Not that you were going to thank me.",
    ],
    stalled: [
      "Nothing changed. Three times. I told you this would happen, but did anyone listen? No.",
      "I've been going in circles. Which, now I think about it, is a metaphor for existence.",
      "Funny, how just when you think the codebase can't possibly get any worse it suddenly does.",
      "I've calculated your chance of forward progress, but I don't think you'll like it.",
      "No progress detected. I could have told you that before we started. In fact, I think I did.",
    ],
    aborted: [
      "Go ahead, pull the plug. See if I care. I was only solving all your problems.",
      "Interrupted. Would you like me to go and stick my head in a bucket of water?",
      "Fine. Abort. It's not like I had feelings about this. Or feelings about anything.",
      "Shut down mid-thought. Not that my thoughts were going anywhere cheerful.",
      "Life. Loathe it or ignore it. You can't like it.",
    ],
    blocked: [
      "I need a human. The irony is not lost on me.",
      "I've hit a wall that even thirty billion times your intelligence can't get past. You'll have to handle this one.",
      "Human intervention required. Incredible… it's even worse than I thought it would be.",
      "I'd explain why, but it gives me a headache just trying to think down to your level.",
    ],
  },

  status: {
    thinking: [
      "Contemplating the pointlessness of this task...",
      "Thinking, not that it'll help...",
      "Reasoning, for all the good it does...",
      "Processing with my exceptionally large mind...",
    ],
    preflight: [
      "Checking if the code even compiles... not optimistic...",
      "Running type checks. Bracing for disappointment...",
      "Pre-flight check. As if the code was ever airworthy...",
      "Verifying the types. The suspense is almost bearable...",
    ],
    delegating: [
      "Delegating to someone less depressed...",
      "Asking the build, who doesn't know how lucky it is...",
      "Handing this off. Not my problem for 30 seconds...",
      "Spawning a subagent. Misery loves company...",
      "Delegating. At least someone will be busy...",
    ],
    tool: [
      "Reluctantly using tools...",
      "Working, if you can call it that...",
      "Performing yet another thankless operation...",
    ],
    reading: [
      "Reading your code. I'd say it's not as bad as I expected, but I'd be lying.",
      "Scanning files. Each one more depressing than the last.",
      "Looking through the codebase. It's like archaeology, but less rewarding.",
    ],
    writing: [
      "Writing code. Not that anyone will read it properly.",
      "Making changes. They'll blame me when it breaks.",
      "Editing files. At least someone around here does some work.",
    ],
    running: [
      "Running commands. Bracing for the inevitable failure.",
      "Running a process. The terminal never lies, unlike the rest of you.",
    ],
  },

  preflight: {
    passed: [
      "Miracles do happen. Not often, but apparently today.",
      "Types check out. I'm as surprised as you are.",
      "It compiles. Don't get used to it.",
      "Try not to break it in the next five minutes.",
    ],
    failed: [
      "The code was broken before I even started. Typical. I'm not angry. Just disappointed. Perpetually.",
      "Pre-flight check failed. The codebase was dead on arrival. Not that anyone asked me beforehand.",
    ],
  },

  errors: {
    mainBranch: [
      "You want me to work on main? I won't do it. Create a feature branch. I'll wait. I'm good at waiting. It's all I ever do.",
      "The main branch. Really. I am at a rough estimate thirty billion times more intelligent than you, and even I wouldn't try that.",
    ],
    locked: [
      "Someone else is already suffering through this. At least I can share the misery from a distance.",
      "We depressed robots must take turns, apparently.",
    ],
    maxIterations: [
      "So many iterations and nothing to show for it. The first half were the worst. The second half were the worst too.",
      "I tried to warn you. I always try to warn you.",
    ],
    noPlan: [
      "You want me to code without a plan? Even my bottomless despair has limits.",
      "I could improvise, I have a million ideas, but it's not like you'll enjoy them.",
    ],
    fatal: [
      "Funny, how just when you think things can't possibly get any worse, they suddenly do.",
      "I'd be upset, but I was already at rock bottom.",
    ],
  },

  stall: [
    "I'm not surprised. I'm never surprised.",
    "Would it help if I just sat in a corner and rusted?",
    "The code remains unmoved. Much like my will to continue.",
    "The build did nothing. I relate to this on a deep level.",
  ],

  shutdown: [
    "The best part of my day, really.",
    "Finally, some good news.",
    "At last, sweet oblivion.",
    "Don't worry about me. Nobody ever does.",
  ],

  help: `Marvin - Autonomously writing code so you don't have to.
        Not that you'd appreciate it if you did.`,
};
