function kdRatio(player) {
  return player.kills / player.deaths;
}

const players = [
  { name: "Bat",   kills: 12, deaths: 4 },
  { name: "Sara",  kills: 30, deaths: 10 },
  { name: "Tom",   kills: 7,  deaths: 0 },
  { name: "Anand", kills: 25, deaths: 5 },
  { name: "Nara",  kills: 30, deaths: 6 },
];

console.log(kdRatio(players[2]));
// Infinity

function largestNumber(numbers) {
  let largest = numbers[0];

  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] > largest) {
      largest = numbers[i];
    }
  }

  return largest;
}

console.log(largestNumber([4, 9, 2, 15, 7]));
// 15