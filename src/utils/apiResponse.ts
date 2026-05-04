export class ApiResponse {
  success: boolean;
  message: string;
  data: any;
  statusCode: number;

  constructor(statusCode: number, message: string, data: any = null) {
    this.statusCode = statusCode;
    this.success = statusCode < 400;
    this.message = message;
    this.data = data;
  }

  static success(res: any, statusCode: number, message: string, data: any = null) {
    return res.status(statusCode).json(new ApiResponse(statusCode, message, data));
  }

  static error(res: any, statusCode: number, message: string, data: any = null) {
    return res.status(statusCode).json(new ApiResponse(statusCode, message, data));
  }
}

export class ApiError extends Error {
  statusCode: number;
  data: any;

  constructor(statusCode: number, message: string, data: any = null) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    Error.captureStackTrace(this, this.constructor);
  }
}
