// function add(a: number, b:number):number{
//     return a+b;
// }
// console.log(add(1,2));

interface JOB{
    id: string;
    status: "pending" | "in-progress" | "completed" | "failed";
    attempt: number;
}

function describe(job: JOB): string{
    return `job id: ${job.id} is status: ${job.status} attempts: ${job.attempt}`;
}

console.log(describe({id: "abc", status: "pending", attempt: 1}));