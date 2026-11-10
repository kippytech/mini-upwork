export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
}

// discrimated union better than the above but suboptimal coz of message/success

// export type ApiResponse<T> =
//   | {
//       success: true;
//       message: string;
//       data: T;
//     }
//   | {
//       success: false;
//       message: string;
//     };

// this is better, removes message

// type ApiResponse<T> =
//   | {
//       success: true;
//       data: T;
//     }
//   | {
//       success: false;
//       message: string;
//     };


//  the 2 below are best

// type ApiSuccess<T> = {
//   data: T;
// };

// type ApiError = {
//   error: {
//     code: string;
//     message: string;
//   };
// };

